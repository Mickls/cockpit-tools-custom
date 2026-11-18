// Adapter inside codex_account scope: use existing authority and mutation guards.
pub(crate) fn credential_sync_identity(account:&CodexAccount)->Result<Vec<u8>,String>{
 if account.is_api_key_auth()||account.is_agent_identity_auth()||account.is_web_session_auth(){return Err("此账号类型不参与凭据同步".into());}
 let (_,subject,_,_,workspace,_) = extract_access_token_identity(&account.tokens.access_token);
 let subject=subject.filter(|s|!s.trim().is_empty()).ok_or("access_token 缺少稳定用户标识，不能自动同步")?;
 let workspace=workspace.filter(|s|!s.trim().is_empty()).ok_or("access_token 缺少稳定工作空间标识，不能自动同步")?;
 if account.account_id.as_deref()!=Some(workspace.as_str()){return Err("本地账号与 access_token 的工作空间不一致".into());}

 serde_json::to_vec(&("openai","chatgpt",subject,workspace,&account.organization_id)).map_err(|_|"账号身份编码失败".into())
}
pub(crate) fn credential_sync_snapshot(id:&str,read_runtime:bool)->Result<CodexAccount,String>{
 let mut account=load_account_checked(id)?.ok_or("账号不存在或已删除")?;let _=credential_sync_identity(&account)?;
 if read_runtime {if sync_account_from_authority_sources(&mut account)?{account=save_account_preserving_egress_proxy(&account)?;}}
 Ok(account)
}
pub(crate) async fn credential_sync_probe(account:&CodexAccount)->Result<(),String>{
 if codex_oauth::is_token_expired(&account.tokens.access_token){return Err("候选 access_token 已过期".into());}
 let response=request_remote_account_check(account).await.map_err(|e|e.message)?;
 validate_account_check_payload(&response,account).map_err(|e|e.message)
}
pub(crate) fn credential_sync_candidate(original:&CodexAccount,tokens:CodexTokens)->Result<CodexAccount,String>{
 let identity=credential_sync_identity(original)?;let _=extract_user_info(&tokens.id_token)?;let mut candidate=original.clone();candidate.tokens=tokens;sync_identity_from_tokens(&mut candidate);
 if candidate.user_id!=original.user_id{return Err("候选 id_token 的用户身份不一致".into());}
 if credential_sync_identity(&candidate)?!=identity{return Err("候选凭据用户或工作空间不匹配".into());}
 if let Some(id)=extract_chatgpt_account_id_from_access_token(&candidate.tokens.access_token){if Some(id.as_str())!=candidate.account_id.as_deref(){return Err("候选 access_token 身份不匹配".into());}}
 Ok(candidate)
}
pub(crate) async fn credential_sync_commit(original:&CodexAccount,candidate:&CodexAccount)->Result<CodexAccount,String>{
 let account_lock=codex_token_lock_for(&original.id);let _token=account_lock.lock().await;
 let _file=acquire_codex_token_refresh_file_lock(&original.id,"remote credential recovery").await?;
 let _guard=CODEX_ACCOUNT_MUTATION_LOCK.lock().map_err(|_|"账号写入锁不可用")?;
 let mut current=load_account_checked(&original.id)?.ok_or("账号已删除，取消远端恢复")?;
 if current.token_generation!=original.token_generation||account_credential_hash(&current)!=account_credential_hash(original)||credential_sync_identity(&current)?!=credential_sync_identity(candidate)?{return Err("本地凭据已变化，取消过期恢复结果".into());}
 let journal_dir=account::get_data_dir()?.join("credential-sync-recovery");std::fs::create_dir_all(&journal_dir).map_err(|_|"恢复记录目录不可用")?;
 let journal=crate::modules::secure_account_storage::serialize_account_file("codex-sync-precommit",&current)?;
 crate::modules::atomic_write::write_string_atomic(&journal_dir.join(format!("{}.json",current.id)),&journal).map_err(|_|"恢复记录保存失败")?;
 current.tokens=candidate.tokens.clone();mark_token_chain_updated(&mut current);current.quota_error=None;
 save_account_with_tombstone_guard(&current)?;Ok(current)
}

#[cfg(test)]mod credential_sync_tests {
 use super::*;
 struct Env{path:PathBuf,previous:Option<std::ffi::OsString>}
 impl Env{fn new()->Self{let path=std::env::temp_dir().join(format!("codex-sync-test-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&path).unwrap();let previous=std::env::var_os("COCKPIT_TOOLS_TEST_DATA_DIR");std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR",&path);Self{path,previous}}}
 impl Drop for Env{fn drop(&mut self){match &self.previous{Some(v)=>std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR",v),None=>std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR")};let _=std::fs::remove_dir_all(&self.path);}}
 fn jwt(value:serde_json::Value)->String{format!("e30.{}.test",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap()))}
 fn tokens(user:&str,workspace:&str,label:&str)->CodexTokens{
  CodexTokens{id_token:jwt(serde_json::json!({"email":"sync@example.invalid","sub":user,"https://api.openai.com/auth":{"chatgpt_user_id":user,"account_id":workspace,"organization_id":"org-sync"}})),access_token:jwt(serde_json::json!({"sub":user,"label":label,"exp":4102444800i64,"https://api.openai.com/auth":{"chatgpt_user_id":user,"chatgpt_account_id":workspace,"organization_id":"org-sync"}})),refresh_token:Some(format!("fake-refresh-{label}"))}
 }
 fn seed()->CodexAccount{let mut a=CodexAccount::new("credential-sync-cas".into(),"sync@example.invalid".into(),tokens("user-sync","account-sync","old"));a.user_id=Some("user-sync".into());a.account_id=Some("account-sync".into());a.organization_id=Some("org-sync".into());save_account(&a).unwrap();a}
 #[test]fn credential_sync_rejects_other_user_workspace_and_malformed_id_token(){
  let original={let mut a=CodexAccount::new("identity".into(),"sync@example.invalid".into(),tokens("user-sync","account-sync","old"));a.user_id=Some("user-sync".into());a.account_id=Some("account-sync".into());a.organization_id=Some("org-sync".into());a};
  assert!(credential_sync_candidate(&original,tokens("other-user","account-sync","new")).is_err());
  assert!(credential_sync_candidate(&original,tokens("user-sync","other-workspace","new")).is_err());
  let mut malformed=tokens("user-sync","account-sync","new");malformed.id_token="not-a-token".into();assert!(credential_sync_candidate(&original,malformed).is_err());
 }
 #[tokio::test]async fn credential_sync_commit_preserves_concurrent_notes_and_tags(){
  let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());let _env=Env::new();let original=seed();
  let candidate=credential_sync_candidate(&original,tokens("user-sync","account-sync","new")).unwrap();let mut edited=original.clone();edited.account_note=Some("keep-note".into());edited.tags=Some(vec!["keep-tag".into()]);save_account(&edited).unwrap();
  let saved=credential_sync_commit(&original,&candidate).await.unwrap();assert_eq!(saved.account_note,edited.account_note);assert_eq!(saved.tags,edited.tags);assert!(saved.token_generation>original.token_generation);assert_eq!(saved.tokens.access_token,candidate.tokens.access_token);
 }
 #[tokio::test]async fn credential_sync_commit_cannot_overwrite_new_authorization(){
  let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());let _env=Env::new();let original=seed();let candidate=credential_sync_candidate(&original,tokens("user-sync","account-sync","remote")).unwrap();
  let mut fresh=original.clone();fresh.tokens=tokens("user-sync","account-sync","new-local");mark_token_chain_updated(&mut fresh);save_account(&fresh).unwrap();assert!(credential_sync_commit(&original,&candidate).await.is_err());assert_eq!(load_account(&original.id).unwrap().tokens.access_token,fresh.tokens.access_token);
 }
 #[tokio::test]async fn credential_sync_commit_cannot_resurrect_deleted_account(){
  let _lock=crate::modules::test_support::env_lock().lock().unwrap_or_else(|e|e.into_inner());let _env=Env::new();let original=seed();let candidate=credential_sync_candidate(&original,tokens("user-sync","account-sync","remote")).unwrap();
  write_account_tombstone(&original.id,true,original.token_generation+1,account_credential_hash(&original)).unwrap();assert!(credential_sync_commit(&original,&candidate).await.is_err());assert!(load_account(&original.id).is_none());
 }
}
