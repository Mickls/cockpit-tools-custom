//! Explicitly opt-in smoke test against the operator's isolated vault on the
//! deployed service. Uses synthetic credentials and temporary client profiles.
use super::*;
use std::{io::Write,process::{Command,Stdio}};
use serde_json::{json,Value};
struct Profiles{previous:Option<std::ffi::OsString>,roots:Vec<PathBuf>}
impl Profiles{
 fn new()->Self{Self{previous:std::env::var_os("COCKPIT_TOOLS_TEST_DATA_DIR"),roots:Vec::new()}}
 fn add(&mut self)->PathBuf{let p=std::env::temp_dir().join(format!("cockpit-sync-probe-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&p).unwrap();self.roots.push(p.clone());p}
 fn select(&self,path:&std::path::Path){std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR",path);}
}
impl Drop for Profiles{fn drop(&mut self){if let Some(value)=&self.previous{std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR",value);}else{std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR");}for root in &self.roots{let _=fs::remove_dir_all(root);}}}
fn enrollment_code(vault:Option<&str>)->String{
 let mut ssh=Command::new("ssh").args(["-o","BatchMode=yes","-o","ConnectTimeout=5","char@100.100.1.1","python3 -"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("SSH probe setup");
 let script=format!(r#"import json,urllib.request
from pathlib import Path
values=dict(line.split('=',1) for line in (Path.home()/'services/cockpit-credential-sync-server/.env').read_text().splitlines() if '=' in line)
body=json.dumps({{"vault_id":{}}}).encode()
request=urllib.request.Request('http://100.100.1.1:18443/v1/enrollment-codes',data=body,headers={{'Content-Type':'application/json','Authorization':'Bearer '+values['SYNC_ADMIN_TOKEN']}})
with urllib.request.urlopen(request,timeout=10) as response:print(response.read().decode())
"#,vault.map(|v|format!("'{}'",v)).unwrap_or_else(||"None".into()));
 ssh.stdin.take().unwrap().write_all(script.as_bytes()).unwrap();let output=ssh.wait_with_output().unwrap();assert!(output.status.success(),"Enrollment setup failed; secret output withheld");let result:Value=serde_json::from_slice(&output.stdout).unwrap();result["code"].as_str().unwrap().into()
}
fn fixture_account()->crate::models::codex::CodexAccount{
 use base64::engine::general_purpose::URL_SAFE_NO_PAD;
 let jwt=|v:Value|format!("e30.{}.fixture",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&v).unwrap()));
 let tokens=crate::models::codex::CodexTokens{id_token:jwt(json!({"email":"protocol-fixture@example.invalid","sub":"fixture-user","https://api.openai.com/auth":{"chatgpt_user_id":"fixture-user","account_id":"fixture-workspace","organization_id":"fixture-org"}})),access_token:jwt(json!({"sub":"fixture-user","exp":4102444800i64,"https://api.openai.com/auth":{"chatgpt_user_id":"fixture-user","chatgpt_account_id":"fixture-workspace","organization_id":"fixture-org"}})),refresh_token:Some("synthetic-not-real-refresh-token".into())};
 let mut a=crate::models::codex::CodexAccount::new("protocol-fixture".into(),"protocol-fixture@example.invalid".into(),tokens);a.user_id=Some("fixture-user".into());a.account_id=Some("fixture-workspace".into());a.organization_id=Some("fixture-org".into());a
}
#[tokio::test]
#[ignore="Requires the Tailscale service with long pairing deployed; only creates an isolated synthetic vault"]
async fn credential_sync_deployed_long_pairing_preserves_existing_devices(){
 let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());
 let mut profiles=Profiles::new();
 let a=profiles.add();let b=profiles.add();let c=profiles.add();let d=profiles.add();
 let configure=|root:&PathBuf|{profiles.select(root);save(CodexCredentialSyncSettings{server_url:"https://100.100.1.1:18444".into(),..Default::default()}).unwrap();};
 configure(&a);
 let first=sdk::register(enrollment_code(None)).await.unwrap();
 let a_id=first.device_id.unwrap();
 let invite=sdk::invite().await.unwrap();
 configure(&b);
 let b_id=sdk::register(invite).await.unwrap().device_id.unwrap();
 profiles.select(&a);
 let pending=sdk::pairings().await.unwrap();
 let request=pending["pairings"][0]["pairing_id"].as_str().unwrap();
 sdk::approve(request.into()).await.unwrap();
 profiles.select(&b);
 assert!(sdk::finish_pairing().await.unwrap());
 profiles.select(&a);
 let code=sdk::manage_long_pairing(false).await.unwrap();
 assert!(code==sdk::manage_long_pairing(false).await.unwrap());
 let content=sdk::keys(&sdk::secret().unwrap()).unwrap().content;
 configure(&c);
 let third=sdk::register(code.clone()).await.unwrap();
 assert!(third.paired);
 assert_eq!(third.vault_id,first.vault_id);
 assert!(content==sdk::keys(&sdk::secret().unwrap()).unwrap().content);
 let c_id=third.device_id.unwrap();
 profiles.select(&b);
 sdk::devices().await.unwrap();
 assert!(sdk::trusted_key(&c_id).is_ok());
 assert_eq!(load().unwrap().device_id,Some(b_id));
 profiles.select(&a);
 let next=sdk::manage_long_pairing(true).await.unwrap();
 assert!(code!=next);
 assert_eq!(load().unwrap().device_id,Some(a_id));
 configure(&d);
 assert!(sdk::register(code).await.is_err());
 assert!(sdk::register(next).await.unwrap().paired);
}
#[tokio::test]
#[ignore="Requires the explicitly authorized Tailscale deployment and SSH; uses isolated synthetic vault"]
async fn credential_sync_deployed_two_clients_backup_recovery_and_rotation(){
 use reqwest::Method;
 let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());let mut profiles=Profiles::new();let a=profiles.add();let b=profiles.add();let c=profiles.add();
 profiles.select(&a);save(CodexCredentialSyncSettings{server_url:"https://100.100.1.1:18444".into(),..Default::default()}).unwrap();
 let first=sdk::register(enrollment_code(None)).await.unwrap();assert!(first.paired);let vault=first.vault_id.unwrap();let invite=sdk::invite().await.unwrap();
 let original=fixture_account();crate::modules::codex_account::save_account(&original).unwrap();
 profiles.select(&b);let pending=sdk::register(invite).await.unwrap();assert!(!pending.paired);let b_id=pending.device_id.unwrap();
 profiles.select(&a);let requests=sdk::pairings().await.unwrap();let pair=requests["pairings"].as_array().unwrap().iter().find(|p|p["device_id"].as_str()==Some(&b_id)).unwrap()["pairing_id"].as_str().unwrap().to_string();sdk::approve(pair).await.unwrap();
 let a_content=sdk::keys(&sdk::secret().unwrap()).unwrap().content;
 worker::upload(&original).await.unwrap();let opaque=crypto::account_key(&sdk::keys(&sdk::secret().unwrap()).unwrap(),&crate::modules::codex_account::credential_sync_identity(&original).unwrap());
 profiles.select(&b);assert!(sdk::finish_pairing().await.unwrap());assert!(a_content==sdk::keys(&sdk::secret().unwrap()).unwrap().content);let _=sdk::devices().await.unwrap();
 let backup=sdk::call(Method::GET,&format!("/v1/accounts/{opaque}/backup"),None).await.unwrap();let envelope:crypto::EncryptedEnvelope=serde_json::from_value(backup["envelope"].clone()).unwrap();let signer=sdk::trusted_key(&envelope.header.sender).unwrap();let plaintext=crypto::open(&sdk::keys(&sdk::secret().unwrap()).unwrap(),&signer,&envelope.header,&envelope).unwrap();let value:Value=serde_json::from_slice(&plaintext).unwrap();assert!(value["tokens"]["refresh_token"].as_str()==Some("synthetic-not-real-refresh-token"));
 profiles.select(&a);let recovery=sdk::export_recovery().await.unwrap();
 profiles.select(&c);let restored=sdk::restore_recovery(recovery.clone(),enrollment_code(Some(&vault))).await.unwrap();assert!(restored.paired);assert!(sdk::keys(&sdk::secret().unwrap()).unwrap().content==a_content);
 profiles.select(&a);let _=sdk::devices().await.unwrap();sdk::revoke(b_id).await.unwrap();let new_content=sdk::keys(&sdk::secret().unwrap()).unwrap().content;assert!(new_content!=a_content);worker::upload(&original).await.unwrap();
 profiles.select(&b);assert!(sdk::devices().await.is_err());
 profiles.select(&c);sdk::sync_rotation().await.unwrap();assert!(sdk::keys(&sdk::secret().unwrap()).unwrap().content==new_content);
 // No request in this test is sent to OpenAI. Provider authorization acceptance
 // remains a separate real-account device acceptance step.
}

#[tokio::test]
async fn credential_sync_network_outage_preserves_local_credentials(){
 let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());let mut profiles=Profiles::new();let root=profiles.add();profiles.select(&root);
 let original=fixture_account();crate::modules::codex_account::save_account(&original).unwrap();
 let signing=load_or_create_device_signing_key().unwrap();let mut state=sdk::secret().unwrap();let generated=crypto::VaultKeys::generate();let mut bytes=generated.content.to_vec();bytes.extend(generated.lookup);state.keys=Some(bytes);state.trusted.insert(device_id(&signing),base64::engine::general_purpose::STANDARD.encode(signing.verifying_key().as_bytes()));sdk::store_secret(&state).unwrap();
 update_settings(|s|{s.enabled=true;s.paired=true;s.server_url="https://127.0.0.1:9".into();s.device_id=Some(device_id(&signing));s.vault_id=Some("test-unreachable-vault".into());}).unwrap();
 assert!(worker::upload(&original).await.is_err());let unchanged=crate::modules::codex_account::load_account(&original.id).unwrap();assert!(unchanged.tokens.access_token==original.tokens.access_token);assert_eq!(unchanged.token_generation,original.token_generation);
}
