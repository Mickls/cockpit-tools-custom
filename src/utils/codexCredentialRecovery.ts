import { isCodexAgentIdentityAccount, isCodexApiKeyAccount, isCodexPendingOAuthAccount, isCodexWebSessionAccount, type CodexAccount } from '../types/codex';
import { isCodexRefreshTokenReauthReason, isCodexRefreshTokenReusedAccount } from './codexSwitchAuthFailure';

/** Display/retry eligibility only; quota exhaustion and transport errors are not auth failures. */
export function canRecoverCodexCredentials(account: CodexAccount): boolean {
  if (isCodexApiKeyAccount(account) || isCodexAgentIdentityAccount(account) ||
      isCodexWebSessionAccount(account) || isCodexPendingOAuthAccount(account) ||
      isCodexRefreshTokenReusedAccount(account)) return false;
  if (account.reauth_reason?.startsWith('官方 app-server 返回 invalid_refresh_token')) return false;
  return account.requires_reauth === true ||
    [account.reauth_reason, account.quota_error?.code, account.quota_error?.message]
      .some(reason => isCodexRefreshTokenReauthReason(reason));
}
