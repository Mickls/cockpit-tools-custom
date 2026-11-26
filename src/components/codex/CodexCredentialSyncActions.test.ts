import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadHookModule, settlePromises } from '../../../tests/helpers/reactHookHarness';
import { canRecoverCodexCredentials } from '../../utils/codexCredentialRecovery';

type Element = { type: string; props: { children?: unknown; onClick?: () => void } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as Element;
    return [el, ...elements(el.props.children)];
  }
  return [];
}

test('one action handles three abnormal OAuth accounts serially and reports a failure without stopping', async () => {
  const accounts = [
    { id: 'one', requires_reauth: true },
    { id: 'two', requires_reauth: false, quota_error: {code:'invalid_refresh_token',message:'invalid_refresh_token',timestamp:1} },
    { id: 'three', requires_reauth: true },
    { id: 'healthy' },
    { id: 'key', requires_reauth: true, auth_mode: 'apikey' },
  ];
  const calls: string[] = [];
  const first = deferred<boolean>();
  let refreshed = 0;
  const settings = { enabled: true, paired: true, recoveryStatus: { one: '在线恢复成功', three: '备份恢复成功' } };
  const h = loadHookModule(new URL('./CodexCredentialSyncActions.tsx', import.meta.url), {
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    './CodexCredentialSyncSettings': { CodexCredentialSyncSettings: () => null },
    '../../hooks/useModalFocusTrap': { useModalFocusTrap: () => {} },
    '../../hooks/useEscClose': { useEscCloseTopmost: () => {} },
    '../../utils/codexCredentialRecovery': { canRecoverCodexCredentials },
    '../../types/codex': {
      isCodexAgentIdentityAccount: () => false,
      isCodexApiKeyAccount: (account: { auth_mode?: string }) => account.auth_mode === 'apikey',
      isCodexPendingOAuthAccount: () => false,
      isCodexWebSessionAccount: () => false,
    },
    '../../services/codexCredentialSyncService': {
      loadCodexCredentialSyncSettings: async () => settings,
      listCodexCredentialSyncAccounts: async () => accounts,
      manualSyncCodexCredential: async (id: string) => {
        calls.push(id);
        if (id === 'one') return first.promise;
        if (id === 'two') throw new Error('请求超时');
        return true;
      },
    },
  }, { setInterval: () => 1, clearInterval: () => {} });
  h.render(() => h.exports.CodexCredentialSyncActions({
    accounts, displayName: (account: { id: string }) => account.id, refresh: async () => { refreshed++; },
  }));
  await settlePromises();
  const button = elements(h.flush()).find(el => el.type === 'button' && el.props.children === 'codex.credentialSync.recoverInvalid');
  assert.ok(button);
  button.props.onClick!();
  await settlePromises();
  assert.deepEqual(calls, ['one']);
  first.resolve(true);
  await settlePromises();
  assert.deepEqual(calls, ['one', 'two', 'three']);
  const text = JSON.stringify(h.flush());
  for (const result of ['在线恢复成功', '请求超时', '备份恢复成功']) assert.ok(text.includes(result));
  assert.equal(refreshed, 1);
  h.unmount();
});

test('recovery button appears when pairing becomes ready without reopening settings', async () => {
  let paired = false;
  let tick: (() => void) | undefined;
  let stopped = false;
  const h = loadHookModule(new URL('./CodexCredentialSyncActions.tsx', import.meta.url), {
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    './CodexCredentialSyncSettings': { CodexCredentialSyncSettings: () => null },
    '../../hooks/useModalFocusTrap': { useModalFocusTrap: () => {} },
    '../../hooks/useEscClose': { useEscCloseTopmost: () => {} },
    '../../utils/codexCredentialRecovery': { canRecoverCodexCredentials },
    '../../services/codexCredentialSyncService': {
      loadCodexCredentialSyncSettings: async () => ({ enabled: true, paired }),
      listCodexCredentialSyncAccounts: async () => [{id:'invalidated',recoveryEligible:true}],
    },
  }, { setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => { stopped = true; } });
  const account = { id: 'invalidated', requires_reauth: false }; // The page snapshot predates the persisted failure.
  h.render(() => h.exports.CodexCredentialSyncActions({ accounts: [account], displayName: () => 'account', refresh: async () => {} }));
  const hasButton = () => elements(h.flush()).some(el => el.type === 'button' && el.props.children === 'codex.credentialSync.recoverInvalid');
  await settlePromises();
  assert.equal(hasButton(), false);
  paired = true;
  tick!();
  await settlePromises();
  assert.equal(hasButton(), true);
  h.unmount();
  assert.equal(stopped, true);
});

test('an explicit recovery action remains available before external SSH failures reach page flags', async () => {
  const calls: string[] = [];
  const h = loadHookModule(new URL('./CodexCredentialSyncActions.tsx', import.meta.url), {
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    './CodexCredentialSyncSettings': { CodexCredentialSyncSettings: () => null },
    '../../hooks/useModalFocusTrap': { useModalFocusTrap: () => {} },
    '../../hooks/useEscClose': { useEscCloseTopmost: () => {} },
    '../../utils/codexCredentialRecovery': { canRecoverCodexCredentials },
    '../../services/codexCredentialSyncService': {
      loadCodexCredentialSyncSettings: async () => ({ enabled: true, paired: true }),
      listCodexCredentialSyncAccounts: async () => [{id:'oauth'}],
      manualSyncCodexCredential: async (id: string) => { calls.push(id); return true; },
    },
  }, { setInterval: () => 1, clearInterval: () => {} });
  h.render(() => h.exports.CodexCredentialSyncActions({ accounts: [{id:'oauth'}, {id:'key', auth_mode:'apikey'}], displayName: () => 'account', refresh: async () => {} }));
  await settlePromises();
  const button=elements(h.flush()).find(el=>el.type==='button'&&el.props.children==='codex.credentialSync.recover');
  assert.ok(button);
  button.props.onClick!();
  await settlePromises();
  assert.deepEqual(calls,['oauth']);
  h.unmount();
});
