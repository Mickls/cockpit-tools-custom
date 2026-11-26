import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexAccount } from '../types/codex';
import { canRecoverCodexCredentials } from './codexCredentialRecovery';

const account = (patch: Partial<CodexAccount>) => ({id:'account',email:'test@example.invalid',tokens:{access_token:'',id_token:''},...patch}) as CodexAccount;
test('recovery action recognizes explicit auth errors even without the reauth flag', () => {
  for (const code of ['invalid_refresh_token','refresh_token_expired','token_invalidated','invalid_grant']) {
    assert.ok(canRecoverCodexCredentials(account({requires_reauth:false,quota_error:{code,message:code,timestamp:1}})),code);
  }
  assert.ok(canRecoverCodexCredentials(account({requires_reauth:true})));
  for (const code of ['429 rate limit','quota_exceeded','insufficient_quota','timeout','401 Unauthorized','500 server error','unsupported_country_region_territory']) {
    assert.equal(canRecoverCodexCredentials(account({quota_error:{code,message:code,timestamp:1}})),false,code);
  }
  assert.equal(canRecoverCodexCredentials(account({requires_reauth:true,reauth_reason:'refresh_token_reused'})),false);
  assert.equal(canRecoverCodexCredentials(account({auth_mode:'apikey',requires_reauth:true})),false);
});
