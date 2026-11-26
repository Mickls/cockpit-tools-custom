use crate::modules::codex_credential_sync::{self,CodexCredentialSyncSettings};
#[tauri::command]
pub fn codex_credential_sync_load() -> Result<CodexCredentialSyncSettings,String>{codex_credential_sync::load()}
#[tauri::command]
pub fn codex_credential_sync_save(settings: CodexCredentialSyncSettings)->Result<CodexCredentialSyncSettings,String>{codex_credential_sync::save(settings)}
#[tauri::command]
pub fn codex_credential_sync_device_public_key() -> Result<String,String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    Ok(STANDARD.encode(codex_credential_sync::load_or_create_device_signing_key()?.verifying_key().as_bytes()))
}
#[tauri::command]
pub async fn codex_credential_sync_enroll(code: String) -> Result<CodexCredentialSyncSettings,String> { crate::modules::codex_credential_sync::enroll(code).await }
#[tauri::command]
pub async fn codex_credential_sync_manual_upload(account_id:String)->Result<(),String>{crate::modules::codex_credential_sync::manual_upload(account_id).await}
#[tauri::command]
pub async fn codex_credential_sync_manual_sync(account_id:String)->Result<bool,String>{crate::modules::codex_credential_sync::manual_sync(account_id).await}
#[tauri::command]
pub async fn codex_credential_sync_create_invite()->Result<String,String>{crate::modules::codex_credential_sync::invite().await}
#[tauri::command]
pub async fn codex_credential_sync_long_pairing(replace:bool)->Result<String,String>{codex_credential_sync::manage_long_pairing(replace).await}
#[tauri::command]
pub async fn codex_credential_sync_list_pairings()->Result<serde_json::Value,String>{crate::modules::codex_credential_sync::pairings().await}
#[tauri::command]
pub async fn codex_credential_sync_approve_pairing(pairing_id:String)->Result<(),String>{crate::modules::codex_credential_sync::approve(pairing_id).await}
#[tauri::command]
pub async fn codex_credential_sync_devices()->Result<serde_json::Value,String>{crate::modules::codex_credential_sync::devices().await}
#[tauri::command]
pub async fn codex_credential_sync_revoke(device_id:String)->Result<(),String>{crate::modules::codex_credential_sync::revoke(device_id).await}
#[tauri::command]
pub async fn codex_credential_sync_export_recovery()->Result<String,String>{crate::modules::codex_credential_sync::export_recovery().await}
#[tauri::command]
pub async fn codex_credential_sync_restore_recovery(code:String,recovery_code:String)->Result<CodexCredentialSyncSettings,String>{crate::modules::codex_credential_sync::restore_recovery(recovery_code,code).await}
#[tauri::command]
pub fn codex_credential_sync_accounts()->Vec<serde_json::Value>{
    crate::modules::codex_account::load_account_index().accounts.into_iter().filter_map(|a|{
        crate::modules::codex_account::credential_sync_snapshot(&a.id,false).ok().map(|account|serde_json::json!({
            "id":account.id,"email":account.email,"accountName":account.account_name,
            "planType":account.plan_type,"accountId":account.account_id,
            "requiresReauth":account.requires_reauth,"hasQuotaError":account.quota_error.is_some(),
            "recoveryEligible":codex_credential_sync::persisted_auth_failure(&account),
            "usageUpdatedAt":account.usage_updated_at
        }))
    }).collect()
}
