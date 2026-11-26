//! Portable client-side cryptography; the HTTP service never owns these keys.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct VaultKeys {
    pub content: [u8; 32],
    pub lookup: [u8; 32],
}
impl VaultKeys {
    pub fn generate() -> Self {
        let mut keys = Self {
            content: [0; 32],
            lookup: [0; 32],
        };
        rand::rngs::OsRng.fill_bytes(&mut keys.content);
        rand::rngs::OsRng.fill_bytes(&mut keys.lookup);
        keys
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Header {
    pub protocol: u32,
    pub vault_id: String,
    pub account_key: String,
    pub key_epoch: i64,
    pub sender: String,
    pub parent_revision: i64,
    pub recipient: Option<String>,
    pub recovery_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub header: Header,
    pub nonce: String,
    pub ciphertext: String,
    pub signature: String,
}
fn header_bytes(header: &Header) -> Result<Vec<u8>, String> {
    if header.protocol != 1 || header.key_epoch < 1 || header.parent_revision < 0 {
        return Err("Invalid envelope header".into());
    }
    serde_json::to_vec(&(header.protocol, &header.vault_id, &header.account_key, header.key_epoch, &header.sender, header.parent_revision, &header.recipient, &header.recovery_id))
        .map_err(|_| "Invalid header".into())
}
fn signed_bytes(envelope: &EncryptedEnvelope) -> Result<Vec<u8>, String> {
    let mut bytes = b"cockpit-credential-sync-envelope-v1\n".to_vec();
    bytes.extend(header_bytes(&envelope.header)?);
    bytes.push(b'\n');
    bytes.extend(envelope.nonce.as_bytes());
    bytes.push(b'\n');
    bytes.extend(envelope.ciphertext.as_bytes());
    Ok(bytes)
}
fn cipher(keys: &VaultKeys, header: &Header) -> Result<Aes256Gcm, String> {
    let hk = Hkdf::<Sha256>::new(Some(header.vault_id.as_bytes()), &keys.content);
    let mut derived = [0u8; 32];
    hk.expand(b"cockpit-credential-sync-content-v1", &mut derived)
        .map_err(|_| "Key derivation failed")?;
    let cipher = Aes256Gcm::new_from_slice(&derived).map_err(|_| "Cipher initialization failed")?;
    derived.zeroize();
    Ok(cipher)
}
pub fn account_key(keys: &VaultKeys, stable_identity: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&keys.lookup).expect("HMAC key length");
    mac.update(b"cockpit-account-v1\n");
    mac.update(stable_identity);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}
pub fn seal(
    keys: &VaultKeys,
    signing: &SigningKey,
    header: Header,
    plaintext: &[u8],
) -> Result<EncryptedEnvelope, String> {
    if plaintext.len() > 40000 {
        return Err("Credential payload too large".into());
    }
    let aad = header_bytes(&header)?;
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher(keys, &header)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| "Encryption failed")?;
    let mut envelope = EncryptedEnvelope {
        header,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
        signature: String::new(),
    };
    envelope.signature = STANDARD.encode(signing.sign(&signed_bytes(&envelope)?).to_bytes());
    Ok(envelope)
}
pub fn verify(envelope: &EncryptedEnvelope, signer: &VerifyingKey) -> Result<(), String> {
    if envelope.ciphertext.len() > 60000 {
        return Err("Envelope too large".into());
    }
    let signature = STANDARD
        .decode(&envelope.signature)
        .map_err(|_| "Invalid signature")?;
    let signature = Signature::from_slice(&signature).map_err(|_| "Invalid signature")?;
    signer
        .verify_strict(&signed_bytes(envelope)?, &signature)
        .map_err(|_| "Invalid envelope signature".into())
}
pub fn open(
    keys: &VaultKeys,
    signer: &VerifyingKey,
    expected: &Header,
    envelope: &EncryptedEnvelope,
) -> Result<Vec<u8>, String> {
    if &envelope.header != expected {
        return Err("Envelope identity or revision mismatch".into());
    }
    verify(envelope, signer)?;
    let nonce = STANDARD
        .decode(&envelope.nonce)
        .map_err(|_| "Invalid nonce")?;
    if nonce.len() != 12 {
        return Err("Invalid nonce length".into());
    }
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|_| "Invalid ciphertext")?;
    let aad = header_bytes(&envelope.header)?;
    cipher(keys, &envelope.header)?
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| "Credential decryption failed".into())
}
pub fn wrap_keys(keys: &VaultKeys, recipient: &crypto_box::PublicKey) -> Result<Vec<u8>, String> {
    let mut plaintext = Vec::with_capacity(64);
    plaintext.extend(keys.content);
    plaintext.extend(keys.lookup);
    let result = recipient
        .seal(&mut rand::rngs::OsRng, &plaintext)
        .map_err(|_| "Device key wrapping failed".into());
    plaintext.zeroize();
    result
}
pub fn unwrap_keys(
    recipient: &crypto_box::SecretKey,
    ciphertext: &[u8],
) -> Result<VaultKeys, String> {
    let mut bytes = recipient
        .unseal(ciphertext)
        .map_err(|_| "Device key unwrapping failed")?;
    if bytes.len() != 64 {
        bytes.zeroize();
        return Err("Invalid wrapped keys".into());
    }
    let mut keys = VaultKeys {
        content: [0; 32],
        lookup: [0; 32],
    };
    keys.content.copy_from_slice(&bytes[..32]);
    keys.lookup.copy_from_slice(&bytes[32..]);
    bytes.zeroize();
    Ok(keys)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn header() -> Header {
        Header {
            protocol: 1,
            vault_id: "vault-one".into(),
            account_key: "opaque-key".into(),
            key_epoch: 1,
            sender: "device-one".into(),
            parent_revision: 0,
            recipient: None,
            recovery_id: None,
        }
    }
    #[test]
    fn encrypted_roundtrip_and_tamper_rejection() {
        let keys = VaultKeys::generate();
        let signer = SigningKey::generate(&mut rand::rngs::OsRng);
        let h = header();
        let env = seal(&keys, &signer, h.clone(), b"private OAuth credentials").unwrap();
        assert_eq!(
            open(&keys, &signer.verifying_key(), &h, &env).unwrap(),
            b"private OAuth credentials"
        );
        assert!(!serde_json::to_string(&env)
            .unwrap()
            .contains("private OAuth"));
        let mut changed = env.clone();
        changed.header.account_key = "other-account".into();
        assert!(verify(&changed, &signer.verifying_key()).is_err());
        assert!(open(&VaultKeys::generate(), &signer.verifying_key(), &h, &env).is_err());
        assert!(open(
            &keys,
            &SigningKey::generate(&mut rand::rngs::OsRng).verifying_key(),
            &h,
            &env
        )
        .is_err());
    }
    #[test]
    fn keys_are_wrapped_for_one_device_only() {
        let keys = VaultKeys::generate();
        let recipient = crypto_box::SecretKey::generate(&mut rand::rngs::OsRng);
        let encrypted = wrap_keys(&keys, &recipient.public_key()).unwrap();
        let recovered = unwrap_keys(&recipient, &encrypted).unwrap();
        assert_eq!(keys.content, recovered.content);
        assert_eq!(keys.lookup, recovered.lookup);
        assert!(unwrap_keys(
            &crypto_box::SecretKey::generate(&mut rand::rngs::OsRng),
            &encrypted
        )
        .is_err());
    }
    #[test]
    fn lookup_keys_are_stable_while_content_keys_rotate() {
        let mut keys = VaultKeys::generate();
        let original = account_key(&keys, b"stable user and workspace");
        keys.content = [7; 32];
        assert_eq!(original, account_key(&keys, b"stable user and workspace"));
        assert_ne!(original, account_key(&keys, b"different workspace"));
    }
}
