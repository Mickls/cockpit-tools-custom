import { useEffect, useId, useState } from 'react';
import { HelpCircle, Upload, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as sync from '../../services/codexCredentialSyncService';
import './CodexCredentialSync.css';

type Pairing = { pairing_id: string; device_id: string; public_key: string; box_public_key: string };
export function CodexCredentialSyncSettings() {
 const { t } = useTranslation();
 const [settings,setSettings]=useState<sync.CodexCredentialSyncSettings>({enabled:false,serverUrl:''});
 const [serverDraft,setServerDraft]=useState('');
 const [code,setCode]=useState('');const [invite,setInvite]=useState('');const [recoveryCode,setRecoveryCode]=useState('');const [recoveryEnrollment,setRecoveryEnrollment]=useState('');const [pending,setPending]=useState<Pairing[]>([]);
 const [longCode,setLongCode]=useState('');const [confirmReplace,setConfirmReplace]=useState(false);const [showLongCode,setShowLongCode]=useState(false);
 const [accounts,setAccounts]=useState<sync.SyncAccount[]>([]);
 const [accountResults,setAccountResults]=useState<Record<string,{message:string;error:boolean}>>({});
 const [activeAccount,setActiveAccount]=useState('');
 const recoveryHelpId=useId();
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const [devices,setDevices]=useState<sync.SyncDevice[]>([]);const [revokeTarget,setRevokeTarget]=useState('');
 const refresh=async()=>{const [next,items]=await Promise.all([sync.loadCodexCredentialSyncSettings(),sync.listCodexCredentialSyncAccounts()]);setSettings(next);setAccounts(items);};
 useEffect(()=>{void sync.loadCodexCredentialSyncSettings().then(s=>{setSettings(s);setServerDraft(s.serverUrl);}).catch(e=>setError(String(e)));void sync.listCodexCredentialSyncAccounts().then(setAccounts).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!settings.enabled)return;const timer=setInterval(()=>{void refresh().catch(()=>undefined);},5000);return()=>clearInterval(timer);},[settings.enabled]);
 const run=async(operation:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await operation();const next=await sync.loadCodexCredentialSyncSettings();setSettings(next);setServerDraft(next.serverUrl);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const accountAction=(account:sync.SyncAccount,action:'upload'|'recover')=>run(async()=>{
  setActiveAccount(account.id);
  setAccountResults(previous=>{const next={...previous};delete next[account.id];return next;});
  try{
   let text:string;
   let failed=false;
   if(action==='upload'){await sync.manualUploadCodexCredential(account.id);text=t('codex.credentialSync.uploaded');}
   else{
    const ok=await sync.manualSyncCodexCredential(account.id);
    const next=await sync.loadCodexCredentialSyncSettings();
    text=next.recoveryStatus?.[account.id]??t(ok?'codex.credentialSync.recovered':'codex.credentialSync.exhausted');
    failed=!ok;
   }
   setAccountResults(previous=>({...previous,[account.id]:{message:text,error:failed}}));
  }catch(cause){
   setAccountResults(previous=>({...previous,[account.id]:{message:String(cause),error:true}}));
  }finally{
   setActiveAccount('');
   await refresh();
  }
 });
 return <div className="settings-row credential-sync-settings">
  <div className="row-label"><div className="row-title">{t('codex.credentialSync.title')}</div><div className="row-desc">{t('codex.credentialSync.desc')}</div></div>
  <div className="row-control credential-sync-controls">
   <label className="credential-sync-field-label" htmlFor="credential-sync-server">{t('codex.credentialSync.server')}</label>
   <div className="credential-sync-field"><input id="credential-sync-server" aria-label={t('codex.credentialSync.server')} className="input input-bordered input-sm" value={serverDraft} placeholder="https://100.100.1.1:18444" disabled={busy||settings.paired} onChange={e=>setServerDraft(e.target.value)}/><button className="btn btn-secondary btn-sm" disabled={busy||settings.paired} onClick={()=>void run(()=>sync.saveCodexCredentialSyncSettings({...settings,serverUrl:sync.normalizeCodexCredentialSyncUrl(serverDraft)}))}>{t('common.save')}</button></div>
   <div className="credential-sync-state"><label className="credential-sync-toggle"><input type="checkbox" checked={settings.enabled} disabled={busy||!settings.serverUrl} onChange={e=>void run(()=>sync.saveCodexCredentialSyncSettings({...settings,enabled:e.target.checked}))}/> {t('codex.credentialSync.enable')}</label>
   <span className={settings.paired?'credential-sync-badge is-paired':'credential-sync-badge'}>{settings.paired?t('codex.credentialSync.paired'):t('codex.credentialSync.unpaired')}</span></div>
   {!settings.paired&&<div style={{display:'flex',gap:6}}><input aria-label={t('codex.credentialSync.enrollment')} className="input input-bordered input-sm" value={code} placeholder={t('codex.credentialSync.enrollment')} type="password" autoComplete="off" disabled={busy} onChange={e=>setCode(e.target.value)}/><button className="btn btn-sm" disabled={busy||!code.trim()} onClick={()=>void run(async()=>{await sync.saveCodexCredentialSyncSettings({...settings,serverUrl:sync.normalizeCodexCredentialSyncUrl(serverDraft)});await sync.enrollCodexCredentialSyncDevice(code.trim());setCode('');})}>{t('codex.credentialSync.enroll')}</button></div>}
   {settings.paired&&<>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <button className="btn btn-primary btn-sm" disabled={busy||!settings.enabled} onClick={()=>void run(async()=>setLongCode(await sync.manageCodexCredentialSyncPairingCode()))}>{t('codex.credentialSync.longCode', '获取长期配对码')}</button>
      <button className="btn btn-sm" disabled={busy||!settings.enabled} onClick={()=>{if(!confirmReplace){setConfirmReplace(true);return;}setConfirmReplace(false);setLongCode('');void run(async()=>setLongCode(await sync.manageCodexCredentialSyncPairingCode(true)));}}>{t(confirmReplace?'codex.credentialSync.confirmReplace':'codex.credentialSync.replaceCode',confirmReplace?'确认更换（旧码将失效）':'更换配对码')}</button>
    </div>
    {longCode&&<div>
      <input readOnly type={showLongCode?'text':'password'} autoComplete="off" aria-label={t('codex.credentialSync.longCode', '获取长期配对码')} value={longCode} onFocus={e=>e.target.select()}/>
      <button className="btn btn-sm" onClick={()=>setShowLongCode(!showLongCode)}>{showLongCode?t('codex.credentialSync.hideCode','隐藏配对码'):t('codex.credentialSync.showCode','查看配对码')}</button>
      <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(longCode);setMessage(t('common.copied','已复制'));})}>{t('common.copy','复制')}</button>
      <button className="btn btn-sm" onClick={()=>{setLongCode('');setShowLongCode(false);}}>{t('common.close','关闭')}</button>
    </div>}
    <details><summary>{t('codex.credentialSync.advanced', '高级操作')}</summary>
    <div style={{display:'flex',gap:6}}><button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{setInvite(await sync.createCodexCredentialSyncInvite());})}>{t('codex.credentialSync.invite')}</button><button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{const result=await sync.listCodexCredentialSyncPairings() as {pairings:Pairing[]};setPending(result.pairings);})}>{t('codex.credentialSync.requests')}</button></div>
    {invite&&<textarea aria-label={t('codex.credentialSync.invite')} className="textarea textarea-bordered" readOnly value={invite} onFocus={e=>e.target.select()}/>}
    {pending.map(p=><div key={p.pairing_id}><small>{p.device_id}<br/>{p.public_key}<br/>{p.box_public_key}</small><button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{await sync.approveCodexCredentialSyncPairing(p.pairing_id);setPending(v=>v.filter(x=>x.pairing_id!==p.pairing_id));})}>{t('codex.credentialSync.approve')}</button></div>)}
    <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>setDevices((await sync.listCodexCredentialSyncDevices()).devices))}>{t('codex.credentialSync.devices')}</button>
    {devices.map(d=><div key={d.device_id}><small>{d.device_id}{d.revoked?` · ${t('codex.credentialSync.revoked')}`:''}</small>{!d.revoked&&d.device_id!==settings.deviceId&&<button className="btn btn-sm" disabled={busy} onClick={()=>{if(revokeTarget!==d.device_id){setRevokeTarget(d.device_id);return;}void run(async()=>{await sync.revokeCodexCredentialSyncDevice(d.device_id);setDevices((await sync.listCodexCredentialSyncDevices()).devices);setRevokeTarget('');});}}>{t(revokeTarget===d.device_id?'common.confirm':'codex.credentialSync.revoke')}</button>}</div>)}
    <ul className="credential-sync-account-list">
     {accounts.map(account=>{
      const label=sync.syncAccountDisplayName(account);
      const status=account.requiresReauth?'authError':account.hasQuotaError||!account.usageUpdatedAt?'authUnknown':'authHealthy';
      const result=accountResults[account.id];
      return <li key={account.id} className="credential-sync-account-row" aria-label={label} aria-busy={activeAccount===account.id}>
       <div className="credential-sync-account-info">
        <strong className="credential-sync-account-name">{label}</strong>
        <span className={`credential-sync-account-status ${status}`}>{t(`codex.credentialSync.${status}`)}</span>
        {result?<small role={result.error?'alert':'status'}>{result.message}</small>:settings.recoveryStatus?.[account.id]&&<small>{settings.recoveryStatus[account.id]}</small>}
       </div>
       <div className="credential-sync-account-buttons">
        <button type="button" className="btn btn-sm" aria-label={`${t('codex.credentialSync.upload')} ${label}`} disabled={busy||!settings.enabled} onClick={()=>void accountAction(account,'upload')}><Upload size={14}/>{t('codex.credentialSync.upload')}</button>
        <button type="button" className="btn btn-sm" aria-label={`${t('codex.credentialSync.recover')} ${label}`} disabled={busy||!settings.enabled} onClick={()=>void accountAction(account,'recover')}><RotateCcw size={14}/>{t('codex.credentialSync.recover')}</button>
       </div>
      </li>;
     })}
    </ul>
    </details>
   </>}
   {!!settings.pendingUploads?.length&&<small>{t('codex.credentialSync.pending',{count:settings.pendingUploads.length})}</small>}
   {settings.paired?<div className="credential-sync-recovery-export">
    <button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{setRecoveryCode(await sync.exportCodexCredentialSyncRecovery());})}>{t('codex.credentialSync.exportRecovery')}</button>
    <span className="credential-sync-help">
     <button type="button" className="credential-sync-help-trigger" aria-label={t('codex.credentialSync.recoveryHelp')} aria-describedby={recoveryHelpId}><HelpCircle size={16}/></button>
     <span role="tooltip" id={recoveryHelpId}>{t('codex.credentialSync.recoveryHelp')}</span>
    </span>
   </div>:<>
    <details><summary>{t('codex.credentialSync.restoreRecovery')}</summary>
    <input type="password" autoComplete="off" aria-label={t('codex.credentialSync.recoveryEnrollment')} className="input input-bordered input-sm" value={recoveryEnrollment} placeholder={t('codex.credentialSync.recoveryEnrollment')} onChange={e=>setRecoveryEnrollment(e.target.value)}/>
    <textarea aria-label={t('codex.credentialSync.recoveryCode')} placeholder={t('codex.credentialSync.recoveryCode')} className="textarea textarea-bordered" readOnly={false} value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value)}/>
    <button className="btn btn-sm" disabled={busy||!recoveryEnrollment||!recoveryCode} onClick={()=>void run(async()=>{await sync.restoreCodexCredentialSyncRecovery(recoveryEnrollment,recoveryCode);setRecoveryCode('');setRecoveryEnrollment('');})}>{t('codex.credentialSync.restoreRecovery')}</button>
    </details>
   </>}
   {recoveryCode&&settings.paired&&<textarea aria-label={t('codex.credentialSync.recoveryCode')} className="textarea textarea-bordered" readOnly value={recoveryCode} onFocus={e=>e.target.select()}/>}

   {(error||settings.lastError)&&<small role="alert">{error||settings.lastError}</small>}{message&&<small role="status">{message}</small>}
  </div>
 </div>;
}
