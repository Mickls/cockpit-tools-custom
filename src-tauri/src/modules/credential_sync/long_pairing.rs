use super::*;
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use zeroize::Zeroizing;

pub const PREFIX: &str = "cockpit-join-v1:";
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Code {
    server: String,
    vault: String,
    version: String,
    epoch: i64,
    creator: String,
    creator_key: String,
    secret: [u8; 32],
}
impl Drop for Code {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.secret);
    }
}
impl Code {
    fn derive(&self, purpose: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
        let salt = format!(
            "cockpit-long-pairing-v1\n{}\n{}\n{}\n{}",
            self.server, self.vault, self.version, self.epoch
        );
        let mut key = Zeroizing::new([0; 32]);
        Hkdf::<Sha256>::new(Some(salt.as_bytes()), &self.secret)
            .expand(purpose, key.as_mut())
            .map_err(|_| "配对密钥派生失败")?;
        Ok(key)
    }
    fn signing(&self) -> Result<SigningKey, String> {
        let seed = self.derive(b"enrollment-proof")?;
        Ok(SigningKey::from_bytes(&seed))
    }
    fn boxing(&self) -> Result<crypto_box::SecretKey, String> {
        Ok(crypto_box::SecretKey::from(
            *self.derive(b"encrypted-vault-capsule")?,
        ))
    }
    fn encode(&self) -> Result<String, String> {
        let bytes = Zeroizing::new(serde_json::to_vec(self).map_err(|_| "配对码编码失败")?);
        Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(&*bytes)))
    }
}

fn sign(mut cert: Certificate, key: &SigningKey) -> Result<Certificate, String> {
    cert.signature = STANDARD.encode(key.sign(&cert_bytes(&cert)?).to_bytes());
    Ok(cert)
}

pub async fn manage(replace: bool) -> Result<String, String> {
    let _operation = OPERATION.lock().await;
    if !ready() {
        return Err("请先完成此设备配对并启用同步".into());
    }
    sync_rotation().await?;
    devices().await?;
    let settings = load()?;
    let vault = settings.vault_id.ok_or("同步库未配置")?;
    let state = secret()?;
    keys(&state)?;
    let remote = call(Method::GET, "/v1/vault/long-pairing", None).await?;
    let active = remote["version"].as_str();
    if !replace {
        if let Some(code) = state
            .long_pairing
            .iter()
            .chain(state.previous_long_pairing.iter())
            .find(|c| {
                Some(c.version.as_str()) == active && c.epoch == state.epoch && c.vault == vault
            })
        {
            return code.encode();
        }
        if active.is_some() {
            return Err("当前配对码由另一台设备创建；可在那台设备查看，或在这里更换".into());
        }
    }
    let key = load_or_create_device_signing_key()?;
    let mut code = Code {
        server: settings.server_url,
        vault,
        version: uuid::Uuid::new_v4().to_string(),
        epoch: state.epoch,
        creator: device_id(&key),
        creator_key: STANDARD.encode(key.verifying_key().as_bytes()),
        secret: [0; 32],
    };
    rand::rngs::OsRng.fill_bytes(&mut code.secret);
    let proof = code.signing()?;
    let bundle = Zeroizing::new(
        serde_json::to_vec(&KeyBundle {
            keys: state.keys,
            epoch: state.epoch,
            trusted: state.trusted,
            recovery: state.recovery,
        })
        .map_err(|_| "配对密钥包编码失败")?,
    );
    let wrap = STANDARD.encode(
        code.boxing()?
            .public_key()
            .seal(&mut rand::rngs::OsRng, &bundle)
            .map_err(|_| "配对密钥包加密失败")?,
    );
    let grant = sign(
        Certificate {
            issuer: code.creator.clone(),
            member: format!("join-{}", code.version),
            public_key: STANDARD.encode(proof.verifying_key().as_bytes()),
            box_public_key: String::new(),
            vault: code.vault.clone(),
            pairing: format!("long-pairing-{}", code.epoch),
            wrapped_hash: format!("{:x}", Sha256::digest(wrap.as_bytes())),
            signature: String::new(),
        },
        &key,
    )?;
    // Preserve locally before sending the request so network ambiguity cannot lose a published code.
    let mut latest = secret()?;
    if latest.epoch != code.epoch {
        return Err("同步库密钥已更换，请重试".into());
    }
    latest.previous_long_pairing = latest
        .long_pairing
        .iter()
        .chain(latest.previous_long_pairing.iter())
        .find(|c| Some(c.version.as_str()) == active)
        .cloned();
    latest.long_pairing = Some(code.clone());
    store_secret(&latest)?;
    let response=call(Method::PUT,"/v1/vault/long-pairing",Some(json!({"expected":active,"version":code.version,"epoch":code.epoch,"grant":grant,"wrap":wrap}))).await?;
    if response["version"].as_str() != Some(&code.version) {
        return Err("配对码版本确认失败".into());
    }
    code.encode()
}

#[derive(Deserialize)]
struct Membership {
    proof: Certificate,
    grant: Certificate,
}

pub(super) fn verify_member(
    text: &str,
    vault: &str,
    trusted: &BTreeMap<String, String>,
) -> Option<Certificate> {
    let Membership { proof, grant } = serde_json::from_str(text).ok()?;
    if proof.vault != vault
        || grant.vault != vault
        || proof.issuer != grant.member
        || !grant.member.starts_with("join-")
        || !grant.box_public_key.is_empty()
        || proof.wrapped_hash != grant.pairing
        || !grant.pairing.starts_with("long-pairing-")
        || uuid::Uuid::parse_str(&proof.pairing).is_err()
    {
        return None;
    }
    let member = public_key(&proof.public_key).ok()?;
    let expected_id = format!("device_{}", URL_SAFE_NO_PAD.encode(&Sha256::digest(member.as_bytes())[..12]));
    if proof.member != expected_id || STANDARD.decode(&proof.box_public_key).ok()?.len() != 32 {
        return None;
    }
    verify_cert(&grant, trusted.get(&grant.issuer)?).ok()?;
    verify_cert(&proof, &grant.public_key).ok()?;
    Some(proof)
}

pub(super) async fn join(encoded: &str) -> Result<CodexCredentialSyncSettings, String> {
    let _operation = OPERATION.lock().await;
    if encoded.len() > 4096 {
        return Err("配对码格式无效".into());
    }
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "配对码格式无效")?,
    );
    let code: Code = serde_json::from_slice(&bytes).map_err(|_| "配对码内容无效")?;
    let settings = load()?;
    if settings.server_url != code.server {
        return Err("配对码与设置的服务器地址不一致".into());
    }
    let mut state = secret()?;
    if state.keys.is_some() {
        return Err("此设备已经配对".into());
    }
    let key = load_or_create_device_signing_key()?;
    let id = device_id(&key);
    let challenge = transport::pairing_request(
        &code.server,
        "/v1/long-pairing/challenge",
        json!({"vault":code.vault,"version":code.version,"device_id":id}),
    )
    .await?;
    let nonce = challenge["nonce"].as_str().ok_or("配对服务未返回挑战")?;
    uuid::Uuid::parse_str(nonce).map_err(|_| "配对挑战无效")?;
    if challenge["epoch"].as_i64() != Some(code.epoch) {
        return Err("配对码已失效，请使用当前配对码".into());
    }
    let signer = code.signing()?;
    let proof = sign(
        Certificate {
            issuer: format!("join-{}", code.version),
            member: id.clone(),
            public_key: STANDARD.encode(key.verifying_key().as_bytes()),
            box_public_key: STANDARD.encode(
                crypto_box::SecretKey::from(state.box_secret)
                    .public_key()
                    .as_bytes(),
            ),
            vault: code.vault.clone(),
            pairing: nonce.into(),
            wrapped_hash: format!("long-pairing-{}", code.epoch),
            signature: String::new(),
        },
        &signer,
    )?;
    let answer = transport::pairing_request(
        &code.server,
        "/v1/long-pairing/join",
        json!({"version":code.version,"nonce":nonce,"proof":proof}),
    )
    .await?;
    let grant: Certificate =
        serde_json::from_value(answer["grant"].clone()).map_err(|_| "配对授权无效")?;
    let wrap = answer["wrap"].as_str().ok_or("缺少加密配对密钥包")?;
    verify_cert(&grant, &code.creator_key)?;
    if grant.issuer != code.creator
        || grant.member != proof.issuer
        || grant.vault != code.vault
        || grant.pairing != proof.wrapped_hash
        || grant.public_key != STANDARD.encode(signer.verifying_key().as_bytes())
        || grant.wrapped_hash != format!("{:x}", Sha256::digest(wrap.as_bytes()))
        || answer["epoch"].as_i64() != Some(code.epoch)
    {
        return Err("配对密钥包的服务器、版本或签名不匹配".into());
    }
    let wrapped = STANDARD.decode(wrap).map_err(|_| "配对密钥包无效")?;
    let data = Zeroizing::new(
        code.boxing()?
            .unseal(&wrapped)
            .map_err(|_| "配对密钥包无法解密")?,
    );
    let bundle: KeyBundle = serde_json::from_slice(&data).map_err(|_| "配对密钥包格式无效")?;
    if bundle.epoch != code.epoch || bundle.trusted.get(&code.creator) != Some(&code.creator_key) {
        return Err("配对库的信任链或密钥代次不匹配".into());
    }
    state.keys = bundle.keys;
    state.epoch = bundle.epoch;
    state.trusted = bundle.trusted;
    state.recovery = bundle.recovery;
    state.trusted.insert(id.clone(), proof.public_key);
    state.pending = None;
    state.long_pairing = Some(code.clone());
    keys(&state)?;
    store_secret(&state)?;
    let result = super::super::update_settings(|s| {
        s.enabled = true;
        s.paired = true;
        s.vault_id = Some(code.vault.clone());
        s.device_id = Some(id);
        s.last_error = None;
    })?;
    super::super::start_worker();
    Ok(result)
}
