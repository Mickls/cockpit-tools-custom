import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { CodexCredentialSyncSettings } from './CodexCredentialSyncSettings';
import * as sync from '../../services/codexCredentialSyncService';
import { isCodexAgentIdentityAccount, isCodexApiKeyAccount, isCodexPendingOAuthAccount, isCodexWebSessionAccount, type CodexAccount } from '../../types/codex';

export function CodexCredentialSyncActions({ accounts, displayName, refresh }: {
  accounts: CodexAccount[];
  displayName: (account: CodexAccount) => string;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Array<{ id: string; message: string }>>([]);
  const refreshAvailability = () => {
    void sync.loadCodexCredentialSyncSettings().then(s => setPaired(s.enabled && s.paired === true)).catch(() => setPaired(false));
  };
  useEffect(refreshAvailability, []);
  useEffect(() => { if (configOpen) dialog.current?.showModal(); }, [configOpen]);
  const eligible = accounts.filter(a => a.requires_reauth && !isCodexApiKeyAccount(a) &&
    !isCodexAgentIdentityAccount(a) && !isCodexWebSessionAccount(a) && !isCodexPendingOAuthAccount(a));
  const recover = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setResults([]);
    try {
      const settings = await sync.loadCodexCredentialSyncSettings();
      if (!settings.enabled || !settings.paired) {
        setConfigOpen(true);
        return;
      }
      const supported = new Set((await sync.listCodexCredentialSyncAccounts()).map(a => a.id));
      // Serial recovery avoids competing for the same helper's short-lived leases.
      for (const account of eligible) {
        let message = t('codex.credentialSync.exhausted');
        try {
          if (!supported.has(account.id)) {
            message = t('codex.credentialSync.unsupported', '此账号无法使用凭据同步');
          } else {
            const ok = await sync.manualSyncCodexCredential(account.id);
            const latest = await sync.loadCodexCredentialSyncSettings();
            message = latest.recoveryStatus?.[account.id] ?? t(ok ? 'codex.credentialSync.recovered' : 'codex.credentialSync.exhausted');
          }
        } catch (cause) {
          message = String(cause);
        }
        setResults(previous => [...previous, { id: account.id, message }]);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      running.current = false;
      setBusy(false);
      await refresh();
    }
  };
  return <section aria-label={t('codex.credentialSync.title')}>
    <button className="btn btn-secondary btn-sm" onClick={() => setConfigOpen(true)}>{t('codex.credentialSync.title')}</button>
    {paired && (eligible.length > 0 || busy) && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void recover()}>
      {t('codex.credentialSync.recoverInvalid', '恢复异常账号')}
    </button>}
    <dialog ref={dialog} className="modal-content" aria-label={t('codex.credentialSync.title')} onClose={() => { setConfigOpen(false); refreshAvailability(); }}>
      <button className="modal-close" aria-label={t('common.close', '关闭')} onClick={() => dialog.current?.close()}><X size={18} /></button>
      {configOpen && <CodexCredentialSyncSettings />}
    </dialog>
    {error && <p role="alert">{error}</p>}
    {results.length > 0 && <ul aria-live="polite">{results.map(row => {
      const account = accounts.find(a => a.id === row.id);
      return <li key={row.id}>{account ? `${displayName(account)}：` : ''}{row.message}</li>;
    })}</ul>}
  </section>;
}
