use base64::Engine;
use ed25519_dalek::SigningKey;
use rand::{rngs::OsRng,RngCore};
use serde::{Deserialize,Serialize};
use sha2::Digest;
use std::{fs,path::PathBuf,sync::Mutex};
#[path="credential_sync/crypto.rs"]mod crypto;
#[path="credential_sync/transport.rs"]mod transport;
#[path="credential_sync/sdk.rs"]mod sdk;
#[path="credential_sync/worker.rs"]mod worker;
pub use sdk::{register as enroll,invite,pairings,approve,finish_pairing,devices,revoke,export_recovery,restore_recovery};
pub use sdk::manage_long_pairing;
pub use worker::{start_worker,manual_upload,manual_sync,recover_if_authorized_failure};
pub use worker::persisted_auth_failure;
static SETTINGS_LOCK:Mutex<()>=Mutex::new(());
static DEVICE_LOCK:Mutex<()>=Mutex::new(());
#[derive(Debug,Clone,Serialize,Deserialize,Default)]
#[serde(rename_all="camelCase",default)]
pub struct CodexCredentialSyncSettings {
 pub enabled:bool,pub server_url:String,pub device_id:Option<String>,pub vault_id:Option<String>,
 pub last_sync_at:Option<i64>,pub last_error:Option<String>,pub pending_uploads:Vec<CodexCredentialSyncPendingUpload>,
 pub paired:bool,pub recovery_status:std::collections::BTreeMap<String,String>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CodexCredentialSyncPendingUpload {pub account_id:String,pub token_generation:u64,pub queued_at:i64}
fn path()->Result<PathBuf,String>{Ok(crate::modules::account::get_data_dir()?.join("codex-credential-sync.json"))}
fn read_settings()->Result<CodexCredentialSyncSettings,String>{
 match fs::read_to_string(path()?){Ok(v)=>serde_json::from_str(&v).map_err(|_|"凭据同步设置损坏，请检查备份".into()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(Default::default()),Err(_)=>Err("无法读取凭据同步设置".into())}
}
pub fn load()->Result<CodexCredentialSyncSettings,String>{let _g=SETTINGS_LOCK.lock().map_err(|_|"同步配置锁不可用")?;read_settings()}
pub(super) fn update_settings(f:impl FnOnce(&mut CodexCredentialSyncSettings))->Result<CodexCredentialSyncSettings,String>{
 let _g=SETTINGS_LOCK.lock().map_err(|_|"同步配置锁不可用")?;let mut s=read_settings()?;f(&mut s);
 let value=serde_json::to_string_pretty(&s).map_err(|_|"同步设置编码失败")?;
 crate::modules::atomic_write::write_string_atomic(&path()?,&value).map_err(|_|"同步设置保存失败")?;Ok(s)
}
pub fn save(mut input:CodexCredentialSyncSettings)->Result<CodexCredentialSyncSettings,String>{
 input.server_url=input.server_url.trim().trim_end_matches('/').into();
 if input.server_url.len()>2048{return Err("同步服务器地址过长".into());}
 if !input.server_url.is_empty(){let _=transport::client(&input.server_url)?;}
 let current=load()?;if current.paired&&current.server_url!=input.server_url{return Err("已配对的同步库不能直接更换服务器，请先移除设备".into());}
 let result=update_settings(|s|{s.enabled=input.enabled;s.server_url=input.server_url;})?;start_worker();Ok(result)
}
#[derive(Serialize,Deserialize)]struct DeviceKey{bytes:Vec<u8>}
pub fn load_or_create_device_signing_key()->Result<SigningKey,String>{
 let _g=DEVICE_LOCK.lock().map_err(|_|"设备私钥锁不可用")?;
 let p=crate::modules::account::get_data_dir()?.join("codex-credential-sync-device.json");
 match fs::read_to_string(&p){
  Ok(content)=>{let value:DeviceKey=crate::modules::secure_account_storage::deserialize_encrypted_snapshot(&content)?;let bytes:[u8;32]=value.bytes.try_into().map_err(|_|"同步设备私钥长度无效")?;Ok(SigningKey::from_bytes(&bytes))},
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{let mut bytes=[0;32];OsRng.fill_bytes(&mut bytes);let encrypted=crate::modules::secure_account_storage::serialize_account_file("codex-sync-device",&DeviceKey{bytes:bytes.to_vec()})?;crate::modules::atomic_write::write_string_atomic(&p,&encrypted).map_err(|_|"保存同步设备私钥失败")?;Ok(SigningKey::from_bytes(&bytes))},
  Err(_)=>Err("无法读取设备私钥，未生成替代密钥".into())
 }
}
pub fn device_id(key:&SigningKey)->String{format!("device_{}",base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&sha2::Sha256::digest(key.verifying_key().as_bytes())[..12]))}
pub fn enqueue_upload(account_id:&str,generation:u64)->Result<CodexCredentialSyncSettings,String>{
 let result={let _g=SETTINGS_LOCK.lock().map_err(|_|"同步配置锁不可用")?;let mut s=read_settings()?;
  if !s.enabled||s.server_url.is_empty(){return Ok(s);}
  s.pending_uploads.retain(|p|p.account_id!=account_id);
  if s.pending_uploads.len()>=2048{return Err("凭据上传队列已满，保留现有任务，请稍后手动上传".into());}
  s.pending_uploads.push(CodexCredentialSyncPendingUpload{account_id:account_id.into(),token_generation:generation,queued_at:chrono::Utc::now().timestamp()});
  let value=serde_json::to_string_pretty(&s).map_err(|_|"同步队列编码失败")?;
  crate::modules::atomic_write::write_string_atomic(&path()?,&value).map_err(|_|"同步队列保存失败")?;s
 };start_worker();Ok(result)
}

pub fn authorization_succeeded(account_id:&str,generation:u64)->Result<CodexCredentialSyncSettings,String>{worker::clear_recovery_epoch(account_id);enqueue_upload(account_id,generation)}

#[cfg(test)]#[path="credential_sync/integration.rs"]mod integration;
