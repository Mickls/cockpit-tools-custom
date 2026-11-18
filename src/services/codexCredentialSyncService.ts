import { invoke } from '@tauri-apps/api/core';

export interface CodexCredentialSyncSettings {
  enabled: boolean;
  paired?: boolean;
  recoveryStatus?: Record<string, string>;
  serverUrl: string;
  deviceId?: string | null;
  vaultId?: string | null;
  lastSyncAt?: number | null;
  lastError?: string | null;
  pendingUploads?: Array<{ accountId: string; tokenGeneration: number; queuedAt: number }>;
}
export const loadCodexCredentialSyncSettings = () => invoke<CodexCredentialSyncSettings>('codex_credential_sync_load');
export const saveCodexCredentialSyncSettings = (settings: CodexCredentialSyncSettings) => invoke<CodexCredentialSyncSettings>('codex_credential_sync_save', { settings });
export const getCodexCredentialSyncDevicePublicKey = () => invoke<string>('codex_credential_sync_device_public_key');
export const enrollCodexCredentialSyncDevice = (code: string) => invoke<CodexCredentialSyncSettings>('codex_credential_sync_enroll', { code });
export const manualUploadCodexCredential = (accountId: string) => invoke<void>('codex_credential_sync_manual_upload', { accountId });
export const manualSyncCodexCredential = (accountId: string) => invoke<boolean>('codex_credential_sync_manual_sync', { accountId });
export const createCodexCredentialSyncInvite = () => invoke<string>('codex_credential_sync_create_invite');
export const manageCodexCredentialSyncPairingCode = (replace = false) => invoke<string>('codex_credential_sync_long_pairing', { replace });
export const listCodexCredentialSyncPairings = () => invoke<unknown>('codex_credential_sync_list_pairings');
export const approveCodexCredentialSyncPairing = (pairingId: string) => invoke<void>('codex_credential_sync_approve_pairing', { pairingId });
export interface SyncDevice { device_id: string; public_key: string; revoked: boolean; online: boolean }
export const listCodexCredentialSyncDevices = () => invoke<{devices:SyncDevice[]}>('codex_credential_sync_devices');
export const revokeCodexCredentialSyncDevice = (deviceId: string) => invoke<void>('codex_credential_sync_revoke', { deviceId });
export const listCodexCredentialSyncAccounts = () => invoke<Array<{id:string;email:string}>>('codex_credential_sync_accounts');
export const exportCodexCredentialSyncRecovery = () => invoke<string>('codex_credential_sync_export_recovery');
export const restoreCodexCredentialSyncRecovery = (code: string, recoveryCode: string) => invoke<CodexCredentialSyncSettings>('codex_credential_sync_restore_recovery', { code, recoveryCode });
export function normalizeCodexCredentialSyncUrl(value: string): string { return value.trim().replace(/\/+$/, ''); }
