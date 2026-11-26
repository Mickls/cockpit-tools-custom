import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { useEscCloseTopmost } from '../../hooks/useEscClose';
import './CodexCredentialSync.css';
import { CodexCredentialSyncSettings } from './CodexCredentialSyncSettings';
import * as sync from '../../services/codexCredentialSyncService';
import type { CodexAccount } from '../../types/codex';
import { canRecoverCodexCredentials } from '../../utils/codexCredentialRecovery';

export function CodexCredentialSyncActions({ accounts, displayName, refresh }: {
  accounts: CodexAccount[];
  displayName: (account: CodexAccount) => string;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState(false);
  const [nativeRecoveryIds, setNativeRecoveryIds] = useState<Set<string>>(new Set());
  const [configOpen, setConfigOpen] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Array<{ id: string; message: string }>>([]);
  const refreshAvailability = () => {
    void sync.loadCodexCredentialSyncSettings().then(s => {
      setPaired(s.enabled && s.paired === true);
      if (!s.enabled || !s.paired) { setNativeRecoveryIds(new Set()); return; }
      // Read metadata so a stale account-page snapshot cannot hide the retry action.
      void sync.listCodexCredentialSyncAccounts().then(items =>
        setNativeRecoveryIds(new Set(items.filter(item => item.recoveryEligible).map(item => item.id))),
      ).catch(() => undefined);
    }).catch(() => setPaired(false));
  };
  useEffect(() => {
    refreshAvailability();
    const timer = setInterval(refreshAvailability, 5000);
    return () => clearInterval(timer);
  }, []);
  const closeConfig = () => { setConfigOpen(false); refreshAvailability(); };
  useModalFocusTrap(dialog, configOpen);
  useEscCloseTopmost(configOpen, closeConfig, dialog);
  const eligible = accounts.filter(a => canRecoverCodexCredentials(a) || nativeRecoveryIds.has(a.id));
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
      // Keep an explicit retry available even when an external Codex/SSH failure
      // has not yet reached this account page's health flags.
      const targets = eligible.length ? eligible : accounts.filter(a => supported.has(a.id));
      // Serial recovery avoids competing for the same helper's short-lived leases.
      for (const account of targets) {
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
  return <section className="credential-sync-actions" aria-label={t('codex.credentialSync.title')}>
    <button className="btn btn-secondary btn-sm" onClick={() => setConfigOpen(true)}>{t('codex.credentialSync.title')}</button>
    {paired && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void recover()}>
      {eligible.length > 0 ? t('codex.credentialSync.recoverInvalid', '恢复异常账号') : t('codex.credentialSync.recover')}
    </button>}
    {configOpen && createPortal(
      <div className="modal-overlay credential-sync-overlay">
        <div ref={dialog} className="modal-content credential-sync-dialog" role="dialog" aria-modal="true"
          aria-labelledby="credential-sync-dialog-title" tabIndex={-1}>
          <div className="modal-header">
            <h2 id="credential-sync-dialog-title">{t('codex.credentialSync.title')}</h2>
            <button type="button" className="modal-close" aria-label={t('common.close', '关闭')} onClick={closeConfig}><X /></button>
          </div>
          <div className="modal-body"><CodexCredentialSyncSettings /></div>
        </div>
      </div>, document.body)}
    {error && <p role="alert">{error}</p>}
    {results.length > 0 && <ul aria-live="polite">{results.map(row => {
      const account = accounts.find(a => a.id === row.id);
      return <li key={row.id}>{account ? `${displayName(account)}：` : ''}{row.message}</li>;
    })}</ul>}
  </section>;
}
