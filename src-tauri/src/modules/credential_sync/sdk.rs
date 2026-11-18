use super::{crypto,transport,load,save,load_or_create_device_signing_key,device_id,CodexCredentialSyncSettings};
use base64::{engine::general_purpose::{STANDARD,URL_SAFE_NO_PAD},Engine};
use ed25519_dalek::{Signer,Signature,VerifyingKey};
use rand::RngCore;
use reqwest::Method;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,path::PathBuf,sync::Mutex};
#[path="long_pairing.rs"] mod long_pairing;
pub use long_pairing::manage as manage_long_pairing;
static SECRET_LOCK:Mutex<()>=Mutex::new(());
#[derive(Clone,Serialize,Deserialize)]
pub struct SecretState {
 pub box_secret:[u8;32],pub keys:Option<Vec<u8>>,pub epoch:i64,#[serde(default)]pub version:u64,
 pub trusted:BTreeMap<String,String>,pub pending:Option<Pending>,
 #[serde(default)]pub recovery:Option<RecoveryPublic>,#[serde(default)]pub recovery_private:Option<[u8;32]>,
 #[serde(default)]long_pairing:Option<long_pairing::Code>,
 #[serde(default)]previous_long_pairing:Option<long_pairing::Code>,
}
#[derive(Clone,Serialize,Deserialize)]pub struct Pending {pub code:String,pub pinned_issuer:String}
#[derive(Clone,Serialize,Deserialize)]pub struct Invite {pub server:String,pub code:String,pub issuer:String}
#[derive(Clone,Serialize,Deserialize)]pub struct Certificate {
 pub issuer:String,pub member:String,pub public_key:String,pub box_public_key:String,
 pub vault:String,pub pairing:String,pub wrapped_hash:String,pub signature:String,
}
fn secret_path()->Result<PathBuf,String>{Ok(crate::modules::account::get_data_dir()?.join("codex-credential-sync-vault.json"))}
pub fn secret()->Result<SecretState,String>{
 let _guard=SECRET_LOCK.lock().map_err(|_|"同步密钥锁不可用")?;let p=secret_path()?;
 match fs::read_to_string(&p) {
  Ok(s)=>crate::modules::secure_account_storage::deserialize_encrypted_snapshot(&s),
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{
   let mut box_secret=[0;32];rand::rngs::OsRng.fill_bytes(&mut box_secret);
   let state=SecretState{box_secret,keys:None,epoch:1,version:0,trusted:BTreeMap::new(),pending:None,recovery:None,recovery_private:None,long_pairing:None,previous_long_pairing:None};write_secret(&state)?;Ok(state)
  },Err(_)=>Err("无法读取同步密钥，未生成替代密钥".into())
 }
}
fn write_secret(state:&SecretState)->Result<(),String>{
 let text=crate::modules::secure_account_storage::serialize_account_file("codex-sync-vault",state)?;
 crate::modules::atomic_write::write_string_atomic(&secret_path()?,&text).map_err(|_|"同步密钥保存失败".into())
}
pub fn store_secret(state:&SecretState)->Result<(),String>{
 let _g=SECRET_LOCK.lock().map_err(|_|"同步密钥锁不可用")?;
 let current=fs::read_to_string(secret_path()?).map_err(|_|"无法校验同步密钥状态")?;
 let current:SecretState=crate::modules::secure_account_storage::deserialize_encrypted_snapshot(&current)?;
 if current.version!=state.version{return Err("同步密钥状态已变化，请重试操作".into());}
 let mut next=state.clone();next.version=next.version.checked_add(1).ok_or("同步密钥状态版本已耗尽")?;write_secret(&next)
}
pub fn keys(state:&SecretState)->Result<crypto::VaultKeys,String>{let b=state.keys.as_ref().ok_or("请先完成设备配对")?;if b.len()!=64{return Err("同步库密钥无效".into());}Ok(crypto::VaultKeys{content:b[..32].try_into().unwrap(),lookup:b[32..].try_into().unwrap()})}
pub fn ready()->bool{load().ok().is_some_and(|s|s.enabled&&s.vault_id.is_some())&&secret().ok().is_some_and(|s|s.keys.is_some())}
pub async fn call(method:Method,path:&str,body:Option<Value>)->Result<Value,String>{let settings=load()?;if !settings.enabled{return Err("凭据同步已关闭".into());}let key=load_or_create_device_signing_key()?;transport::request(&settings.server_url,&device_id(&key),&key,method,path,body).await}
fn cert_bytes(c:&Certificate)->Result<Vec<u8>,String>{serde_json::to_vec(&(&c.issuer,&c.member,&c.public_key,&c.box_public_key,&c.vault,&c.pairing,&c.wrapped_hash)).map_err(|_|"配对证明编码失败".into())}
fn public_key(value:&str)->Result<VerifyingKey,String>{let b:[u8;32]=STANDARD.decode(value).map_err(|_|"设备公钥无效")?.try_into().map_err(|_|"设备公钥长度无效")?;VerifyingKey::from_bytes(&b).map_err(|_|"设备公钥无效".into())}
fn verify_cert(c:&Certificate,issuer:&str)->Result<(),String>{let s=STANDARD.decode(&c.signature).map_err(|_|"配对签名无效")?;public_key(issuer)?.verify_strict(&cert_bytes(c)?,&Signature::from_slice(&s).map_err(|_|"配对签名无效")?).map_err(|_|"配对签名验证失败".into())}
pub async fn register(input:String)->Result<CodexCredentialSyncSettings,String>{
 if let Some(encoded)=input.trim().strip_prefix(long_pairing::PREFIX){return long_pairing::join(encoded).await;}
 let mut config=load()?;let key=load_or_create_device_signing_key()?;let id=device_id(&key);
 if secret()?.keys.is_some(){return Err("此设备已经配对；请勿重复登记".into());}
 let (code,pin)=if let Some(encoded)=input.trim().strip_prefix("cockpit-sync-v1:") {
  let invite:Invite=serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).map_err(|_|"配对码无效")?).map_err(|_|"配对码无效")?;
  if !config.server_url.is_empty()&&config.server_url!=invite.server{return Err("配对码服务器与设置不一致".into());}
  config.server_url=invite.server;(invite.code,invite.issuer)
 }else{(input.trim().to_string(),String::new())};
 let mut state=secret()?;let box_key=crypto_box::SecretKey::from(state.box_secret);
 let result=transport::enroll(&config.server_url,&code,&id,&STANDARD.encode(key.verifying_key().as_bytes()),&STANDARD.encode(box_key.public_key().as_bytes())).await?;
 config.device_id=Some(id.clone());config.vault_id=Some(result["vault_id"].as_str().ok_or("登记响应缺少同步库标识")?.into());config.enabled=true;
 if result["first_device"].as_bool()==Some(true){
  let k=crypto::VaultKeys::generate();let mut bytes=k.content.to_vec();bytes.extend(k.lookup);state.keys=Some(bytes);state.trusted.insert(id,STANDARD.encode(key.verifying_key().as_bytes()));state.pending=None;
 }else{if pin.is_empty(){return Err("添加设备请使用已有设备生成的配对码".into());}state.pending=Some(Pending{code,pinned_issuer:pin});}
 store_secret(&state)?;config.last_error=None;let result=super::update_settings(|s|{s.server_url=config.server_url;s.device_id=config.device_id;s.vault_id=config.vault_id;s.enabled=true;s.paired=state.keys.is_some();s.last_error=None;})?;super::start_worker();Ok(result)
}
pub async fn invite()->Result<String,String>{
 if !ready(){return Err("请先完成此设备配对".into());}
 let result=call(Method::POST,"/v1/invitations",Some(json!({}))).await?;
 let invite=Invite{server:load()?.server_url,code:result["code"].as_str().ok_or("服务未返回配对码")?.into(),issuer:STANDARD.encode(load_or_create_device_signing_key()?.verifying_key().as_bytes())};
 Ok(format!("cockpit-sync-v1:{}",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&invite).map_err(|_|"配对码编码失败")?)))
}
pub async fn pairings()->Result<Value,String>{call(Method::GET,"/v1/pairings/pending",None).await}
pub async fn approve(pairing_id:String)->Result<(),String>{
 let list=pairings().await?;let item=list["pairings"].as_array().and_then(|a|a.iter().find(|v|v["pairing_id"].as_str()==Some(&pairing_id))).ok_or("配对请求已失效")?;
 let member=item["device_id"].as_str().ok_or("配对设备标识缺失")?.to_string();let public=item["public_key"].as_str().ok_or("配对设备公钥缺失")?.to_string();let enc=item["box_public_key"].as_str().ok_or("配对设备加密公钥缺失")?.to_string();
 let enc_bytes:[u8;32]=STANDARD.decode(&enc).map_err(|_|"配对加密公钥无效")?.try_into().map_err(|_|"配对加密公钥长度无效")?;
 let mut state=secret()?;let _=keys(&state)?;let signing=load_or_create_device_signing_key()?;
 state.trusted.insert(member.clone(),public.clone());
 let bundle=serde_json::to_vec(&KeyBundle{keys:state.keys.clone(),epoch:state.epoch,trusted:state.trusted.clone(),recovery:state.recovery.clone()}).map_err(|_|"配对密钥编码失败")?;
 let wrapped=crypto_box::PublicKey::from(enc_bytes).seal(&mut rand::rngs::OsRng,&bundle).map_err(|_|"配对加密失败")?;
 let mut cert=Certificate{issuer:device_id(&signing),member,public_key:public,box_public_key:enc,vault:load()?.vault_id.ok_or("同步库未初始化")?,pairing:pairing_id.clone(),wrapped_hash:format!("{:x}",Sha256::digest(&wrapped)),signature:String::new()};
 cert.signature=STANDARD.encode(signing.sign(&cert_bytes(&cert)?).to_bytes());
 call(Method::POST,&format!("/v1/pairings/{pairing_id}/approve"),Some(json!({"encrypted_key_wrap":STANDARD.encode(&wrapped),"membership_signature":serde_json::to_string(&cert).map_err(|_|"配对证明编码失败")?}))).await?;
 let mut latest=secret()?;latest.trusted.insert(cert.member,cert.public_key);store_secret(&latest)
}
pub async fn finish_pairing()->Result<bool,String>{
 let mut state=secret()?;let Some(pending)=state.pending.clone()else{return Ok(state.keys.is_some());};let config=load()?;let key=load_or_create_device_signing_key()?;
 let response=transport::poll_enrollment(&config.server_url,&pending.code,&device_id(&key)).await?;
 if response["status"].as_str()!=Some("approved"){return Ok(false);}
 let cert:Certificate=serde_json::from_str(response["membership_signature"].as_str().ok_or("缺少配对证明")?).map_err(|_|"配对证明无效")?;
 verify_cert(&cert,&pending.pinned_issuer)?;
 let wrapped=STANDARD.decode(response["encrypted_key_wrap"].as_str().ok_or("缺少加密配对数据")?).map_err(|_|"加密配对数据无效")?;
 if cert.member!=device_id(&key)||cert.vault!=config.vault_id.as_deref().unwrap_or("")||cert.public_key!=STANDARD.encode(key.verifying_key().as_bytes())||cert.wrapped_hash!=format!("{:x}",Sha256::digest(&wrapped)){return Err("配对身份或密钥绑定不一致".into());}
 let decrypted=crypto_box::SecretKey::from(state.box_secret).unseal(&wrapped).map_err(|_|"配对数据解密失败")?;
 let bundle:KeyBundle=serde_json::from_slice(&decrypted).map_err(|_|"配对数据无效")?;
 state.keys=bundle.keys;state.epoch=bundle.epoch;state.trusted=bundle.trusted;state.recovery=bundle.recovery;state.pending=None;let _=self::keys(&state)?;store_secret(&state)?;super::update_settings(|s|{s.paired=true;s.last_error=None;})?;Ok(true)
}
pub async fn devices()->Result<Value,String>{
 let value=call(Method::GET,"/v1/devices",None).await?;let mut state=secret()?;
 let items=value["devices"].as_array().ok_or("设备列表无效")?;let vault=load()?.vault_id.ok_or("同步库未配置")?;let mut changed=false;
 for _ in 0..items.len().min(64){let mut added=false;for item in items{
  if item["revoked"].as_bool()==Some(true){continue;}
  let Some(text)=item["certificate"].as_str()else{continue};
  let cert=match serde_json::from_str::<Certificate>(text) {
   Ok(cert)=>cert,
   Err(_)=>{
    let Some(cert)=long_pairing::verify_member(text,&vault,&state.trusted)else{continue};
    // Old grants cannot introduce new identities after a key rotation.
    if cert.wrapped_hash!=format!("long-pairing-{}",state.epoch){continue;}
    if item["device_id"].as_str()!=Some(&cert.member)||item["public_key"].as_str()!=Some(&cert.public_key)
      ||item["box_public_key"].as_str()!=Some(&cert.box_public_key)||state.trusted.contains_key(&cert.member){continue;}
    state.trusted.insert(cert.member,cert.public_key);added=true;changed=true;continue;
   }
  };
  if cert.vault!=vault||item["device_id"].as_str()!=Some(&cert.member)||item["public_key"].as_str()!=Some(&cert.public_key){continue;}
  if state.trusted.contains_key(&cert.member){continue;}
  let issuer=if cert.issuer=="recovery"{state.recovery.as_ref().map(|r|r.signing_key.clone())}else{state.trusted.get(&cert.issuer).cloned()};
  if let Some(issuer)=issuer{if verify_cert(&cert,&issuer).is_ok(){state.trusted.insert(cert.member,cert.public_key);added=true;changed=true;}}
 }if !added{break;}}
 if changed{store_secret(&state)?;}Ok(value)
}
pub fn trusted_key(sender:&str)->Result<VerifyingKey,String>{let state=secret()?;public_key(state.trusted.get(sender).ok_or("候选设备未经本机信任链验证")?)}
pub async fn revoke(target:String)->Result<(),String>{
 let list=devices().await?;let signing=super::load_or_create_device_signing_key()?;if target==super::device_id(&signing){return Err("不能在这里撤销当前设备".into());}
 let result=call(Method::POST,&format!("/v1/devices/{target}/revoke"),None).await?;
 let epoch=result["key_epoch"].as_i64().ok_or("撤销响应缺少密钥代次")?;
 let mut state=secret()?;let old=keys(&state)?;let generated=crypto::VaultKeys::generate();let mut next=generated.content.to_vec();next.extend(old.lookup);state.keys=Some(next);state.epoch=epoch;state.trusted.remove(&target);store_secret(&state)?;
 distribute_rotation(&state,&list,&target).await?;
 if state.recovery.is_some(){publish_recovery(&state).await?;}
 for item in crate::modules::codex_account::load_account_index().accounts {if let Ok(account)=crate::modules::codex_account::credential_sync_snapshot(&item.id,false){let _=super::enqueue_upload(&account.id,account.token_generation);}}
 Ok(())
}
async fn distribute_rotation(state:&SecretState,list:&Value,revoked:&str)->Result<(),String>{
 let signing=super::load_or_create_device_signing_key()?;let own=super::device_id(&signing);let vault=load()?.vault_id.ok_or("同步库未初始化")?;
 let mut wraps=Vec::new();
 for item in list["devices"].as_array().ok_or("设备列表无效")? {
  let id=item["device_id"].as_str().ok_or("设备标识无效")?;
  if id==revoked||item["revoked"].as_bool()==Some(true){continue;}
  let public=state.trusted.get(id).ok_or("不能为未经信任的设备分发密钥")?;
  if item["public_key"].as_str()!=Some(public){return Err("设备公钥与本机信任记录不一致".into());}
  let enc=item["box_public_key"].as_str().ok_or("设备缺少加密公钥")?;let enc_bytes:[u8;32]=STANDARD.decode(enc).map_err(|_|"设备加密公钥无效")?.try_into().map_err(|_|"设备加密公钥长度无效")?;
  let bundle=serde_json::to_vec(&KeyBundle{keys:state.keys.clone(),epoch:state.epoch,trusted:state.trusted.clone(),recovery:state.recovery.clone()}).map_err(|_|"轮换密钥编码失败")?;
  let wrapped=crypto_box::PublicKey::from(enc_bytes).seal(&mut rand::rngs::OsRng,&bundle).map_err(|_|"轮换密钥封装失败")?;
  let mut cert=Certificate{issuer:own.clone(),member:id.into(),public_key:public.clone(),box_public_key:enc.into(),vault:vault.clone(),pairing:format!("rotation-{}",state.epoch),wrapped_hash:format!("{:x}",Sha256::digest(&wrapped)),signature:String::new()};cert.signature=STANDARD.encode(signing.sign(&cert_bytes(&cert)?).to_bytes());
  wraps.push(json!({"device_id":id,"encrypted_key_wrap":STANDARD.encode(wrapped),"certificate":serde_json::to_string(&cert).map_err(|_|"轮换证明编码失败")?}));
 }
 call(Method::POST,"/v1/vault/key-wraps",Some(json!({"key_epoch":state.epoch,"wraps":wraps}))).await?;Ok(())
}
pub async fn sync_rotation()->Result<(),String>{
 let result=call(Method::GET,"/v1/vault/key-wrap",None).await?;let epoch=result["key_epoch"].as_i64().ok_or("服务器密钥代次无效")?;let mut state=secret()?;
 if epoch<state.epoch{return Err("拒绝同步库密钥代次回退".into());}
 if epoch==state.epoch{
  if epoch>1&&result["encrypted_key_wrap"].is_null(){let list=devices().await?;return distribute_rotation(&state,&list,"").await;}
  return Ok(());
 }
 let cert:Certificate=serde_json::from_str(result["certificate"].as_str().ok_or("等待可信设备分发轮换密钥")?).map_err(|_|"轮换证明无效")?;
 verify_cert(&cert,state.trusted.get(&cert.issuer).ok_or("轮换设备未经信任")?)?;
 let key=super::load_or_create_device_signing_key()?;let wrapped=STANDARD.decode(result["encrypted_key_wrap"].as_str().ok_or("轮换密钥缺失")?).map_err(|_|"轮换密钥无效")?;
 if cert.member!=super::device_id(&key)||cert.public_key!=STANDARD.encode(key.verifying_key().as_bytes())||cert.vault!=load()?.vault_id.as_deref().unwrap_or("")||cert.pairing!=format!("rotation-{epoch}")||cert.wrapped_hash!=format!("{:x}",Sha256::digest(&wrapped)){return Err("轮换密钥绑定不一致".into());}
 let bytes=crypto_box::SecretKey::from(state.box_secret).unseal(&wrapped).map_err(|_|"轮换密钥解密失败")?;
 let bundle:KeyBundle=serde_json::from_slice(&bytes).map_err(|_|"轮换密钥格式无效")?;
 if bundle.epoch!=epoch{return Err("轮换密钥代次无效".into());}
 state.keys=bundle.keys;state.epoch=epoch;state.trusted=bundle.trusted;state.recovery=bundle.recovery;let _=self::keys(&state)?;store_secret(&state)?;
 // Re-encrypt local credentials under the new epoch; no automatic token refresh.
 for item in crate::modules::codex_account::load_account_index().accounts {if let Ok(account)=crate::modules::codex_account::credential_sync_snapshot(&item.id,false){let _=super::enqueue_upload(&account.id,account.token_generation);}}
 Ok(())
}

#[derive(Clone,Serialize,Deserialize)]pub struct RecoveryPublic{pub public_key:String,pub signing_key:String}
#[derive(Serialize,Deserialize)]struct KeyBundle{keys:Option<Vec<u8>>,epoch:i64,trusted:BTreeMap<String,String>,#[serde(default)]recovery:Option<RecoveryPublic>}
#[derive(Serialize,Deserialize)]struct RecoveryCode{server:String,vault:String,private_key:[u8;32],trusted:BTreeMap<String,String>}
fn recovery_signing(secret:&[u8;32])->ed25519_dalek::SigningKey{let mut digest=Sha256::new();digest.update(b"cockpit-recovery-signing-v1");digest.update(secret);ed25519_dalek::SigningKey::from_bytes(&digest.finalize().into())}
async fn publish_recovery(state:&SecretState)->Result<(),String>{
 let metadata=state.recovery.as_ref().ok_or("尚未创建恢复密钥")?;let bytes:[u8;32]=STANDARD.decode(&metadata.public_key).map_err(|_|"恢复公钥无效")?.try_into().map_err(|_|"恢复公钥长度无效")?;
 let bundle=serde_json::to_vec(&KeyBundle{keys:state.keys.clone(),epoch:state.epoch,trusted:state.trusted.clone(),recovery:state.recovery.clone()}).map_err(|_|"恢复数据编码失败")?;
 let wrapped=crypto_box::PublicKey::from(bytes).seal(&mut rand::rngs::OsRng,&bundle).map_err(|_|"恢复数据加密失败")?;
 let signing=super::load_or_create_device_signing_key()?;
 let mut cert=Certificate{issuer:super::device_id(&signing),member:"recovery".into(),public_key:metadata.signing_key.clone(),box_public_key:metadata.public_key.clone(),vault:load()?.vault_id.ok_or("未配置同步库")?,pairing:format!("recovery-capsule-{}",state.epoch),wrapped_hash:format!("{:x}",Sha256::digest(&wrapped)),signature:String::new()};cert.signature=STANDARD.encode(signing.sign(&cert_bytes(&cert)?).to_bytes());
 call(Method::PUT,"/v1/vault/recovery",Some(json!({"public_key":metadata.public_key,"signing_key":metadata.signing_key,"key_epoch":state.epoch,"encrypted_key_wrap":STANDARD.encode(wrapped),"certificate":serde_json::to_string(&cert).map_err(|_|"恢复证明编码失败")?}))).await?;Ok(())
}
pub async fn export_recovery()->Result<String,String>{
 if !ready(){return Err("请先完成设备配对".into());}
 let mut state=secret()?;
 if state.recovery.is_some()&&state.recovery_private.is_none(){return Err("请使用创建恢复密钥的设备导出，或使用已经离线保存的恢复码".into());}
 if state.recovery_private.is_none(){let mut bytes=[0;32];rand::rngs::OsRng.fill_bytes(&mut bytes);let signing=recovery_signing(&bytes);let box_key=crypto_box::SecretKey::from(bytes);state.recovery_private=Some(bytes);state.recovery=Some(RecoveryPublic{public_key:STANDARD.encode(box_key.public_key().as_bytes()),signing_key:STANDARD.encode(signing.verifying_key().as_bytes())});store_secret(&state)?;}
 publish_recovery(&state).await?;
 let recovery=RecoveryCode{server:load()?.server_url,vault:load()?.vault_id.ok_or("未配置同步库")?,private_key:state.recovery_private.ok_or("恢复密钥缺失")?,trusted:state.trusted};
 Ok(format!("cockpit-recovery-v1:{}",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&recovery).map_err(|_|"恢复码编码失败")?)))
}
pub async fn refresh_recovery()->Result<(),String>{
 let mut state=secret()?;
 let response=match call(Method::GET,"/v1/vault/recovery",None).await{Ok(v)=>v,Err(e)if e.contains("HTTP 404")=>{if state.recovery.is_some(){publish_recovery(&state).await?;}return Ok(())},Err(e)=>return Err(e)};
 if state.recovery.is_some()&&response["key_epoch"].as_i64().is_some_and(|e|e<state.epoch){return publish_recovery(&state).await;}
 let cert:Certificate=serde_json::from_str(response["certificate"].as_str().ok_or("恢复证明缺失")?).map_err(|_|"恢复证明无效")?;
 verify_cert(&cert,state.trusted.get(&cert.issuer).ok_or("恢复证明设备未经信任")?)?;
 if cert.vault!=load()?.vault_id.as_deref().unwrap_or("")||cert.member!="recovery"||Some(cert.public_key.as_str())!=response["signing_key"].as_str()||Some(cert.box_public_key.as_str())!=response["public_key"].as_str(){return Err("恢复公钥绑定无效".into());}
 if let Some(metadata)=&state.recovery {if metadata.public_key!=cert.box_public_key||metadata.signing_key!=cert.public_key{return Err("恢复公钥与本机信任记录不一致".into());}}
 if state.recovery.is_none(){
  state.recovery=Some(RecoveryPublic{public_key:cert.box_public_key,signing_key:cert.public_key});store_secret(&state)?;
 }
 if response["key_epoch"].as_i64()!=Some(state.epoch){publish_recovery(&state).await?;}
 Ok(())
}
pub async fn restore_recovery(input:String,code:String)->Result<CodexCredentialSyncSettings,String>{
 if secret()?.keys.is_some(){return Err("此设备已经配对，不需要恢复".into());}
 let encoded=input.trim().strip_prefix("cockpit-recovery-v1:").ok_or("恢复码格式无效")?;
 let recovery:RecoveryCode=serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).map_err(|_|"恢复码编码无效")?).map_err(|_|"恢复码内容无效")?;
 let _=transport::client(&recovery.server)?;let signing=super::load_or_create_device_signing_key()?;let id=super::device_id(&signing);let mut state=secret()?;let box_key=crypto_box::SecretKey::from(state.box_secret);let proof_signer=recovery_signing(&recovery.private_key);
 let mut proof=Certificate{issuer:"recovery".into(),member:id.clone(),public_key:STANDARD.encode(signing.verifying_key().as_bytes()),box_public_key:STANDARD.encode(box_key.public_key().as_bytes()),vault:recovery.vault.clone(),pairing:uuid::Uuid::new_v4().to_string(),wrapped_hash:format!("{:x}",Sha256::digest(code.as_bytes())),signature:String::new()};proof.signature=STANDARD.encode(proof_signer.sign(&cert_bytes(&proof)?).to_bytes());
 let response=transport::recover_enrollment(&recovery.server,json!({"code":code,"device_id":id,"public_key":proof.public_key,"box_public_key":proof.box_public_key,"certificate":serde_json::to_string(&proof).map_err(|_|"恢复登记证明编码失败")?})).await?;
 let cert:Certificate=serde_json::from_str(response["certificate"].as_str().ok_or("恢复证明缺失")?).map_err(|_|"恢复证明无效")?;
 let mut trusted=recovery.trusted;
 if let Some(items)=response["devices"].as_array(){for _ in 0..items.len().min(64){for item in items{
  let Some(text)=item["certificate"].as_str()else{continue};
  let cert=if let Ok(c)=serde_json::from_str::<Certificate>(text){
   let issuer=if c.issuer=="recovery"{Some(STANDARD.encode(proof_signer.verifying_key().as_bytes()))}else{trusted.get(&c.issuer).cloned()};
   issuer.filter(|issuer|verify_cert(&c,issuer).is_ok()).map(|_|c)
  }else{long_pairing::verify_member(text,&recovery.vault,&trusted)};
  if let Some(c)=cert.filter(|c|c.vault==recovery.vault&&item["device_id"].as_str()==Some(&c.member)&&item["public_key"].as_str()==Some(&c.public_key)){
   trusted.entry(c.member).or_insert(c.public_key);
  }
 }}}
 verify_cert(&cert,trusted.get(&cert.issuer).ok_or("恢复设备无法从离线信任记录验证")?)?;
 let wrapped=STANDARD.decode(response["encrypted_key_wrap"].as_str().ok_or("恢复密文缺失")?).map_err(|_|"恢复密文无效")?;
 if cert.vault!=recovery.vault||cert.member!="recovery"||cert.public_key!=STANDARD.encode(proof_signer.verifying_key().as_bytes())||cert.box_public_key!=STANDARD.encode(crypto_box::SecretKey::from(recovery.private_key).public_key().as_bytes())||cert.wrapped_hash!=format!("{:x}",Sha256::digest(&wrapped)){return Err("恢复密文身份绑定无效".into());}
 let plaintext=crypto_box::SecretKey::from(recovery.private_key).unseal(&wrapped).map_err(|_|"恢复密钥不能解密服务器密文")?;
 let bundle:KeyBundle=serde_json::from_slice(&plaintext).map_err(|_|"恢复数据格式无效")?;
 if response["key_epoch"].as_i64()!=Some(bundle.epoch){return Err("恢复密钥代次无效".into());}
 state.keys=bundle.keys;state.epoch=bundle.epoch;state.trusted=bundle.trusted;state.recovery=bundle.recovery;state.trusted.insert(id.clone(),STANDARD.encode(signing.verifying_key().as_bytes()));state.pending=None;let _=keys(&state)?;store_secret(&state)?;
 let config=super::update_settings(|s|{s.server_url=recovery.server;s.vault_id=Some(recovery.vault);s.device_id=Some(id);s.enabled=true;s.paired=true;s.last_error=None;})?;super::start_worker();Ok(config)
}
