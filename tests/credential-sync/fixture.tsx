import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from '../../src/locales/zh-CN.json';
import { CodexCredentialSyncActions } from '../../src/components/codex/CodexCredentialSyncActions';
import '../../src/App.css';

// Synthetic UI fixture: no credentials, local profiles, or real service calls.
let backgroundClicks = 0;
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: () => 1,
  unregisterCallback: () => {},
  invoke: async (command) => {
    if (command === 'codex_credential_sync_accounts') return [];
    if (command === 'codex_credential_sync_long_pairing') return 'synthetic-pairing-code';
    return { enabled: true, paired: true, serverUrl: 'https://example.test', deviceId: 'fixture-device' };
  },
};
i18next.use(initReactI18next).init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zh } } }).then(() => {
  createRoot(document.getElementById('root')!).render(<main style={{ padding: 80 }}>
    <h1>Codex</h1>
    <button onClick={() => { backgroundClicks++; document.body.dataset.backgroundClicks = String(backgroundClicks); }}>背景操作</button>
    <CodexCredentialSyncActions accounts={[]} displayName={() => ''} refresh={async () => {}} />
  </main>);
});
