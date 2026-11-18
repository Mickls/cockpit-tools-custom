import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as sync from '../../services/codexCredentialSyncService';

type Pairing = { pairing_id: string; device_id: string; public_key: string; box_public_key: string };
export function CodexCredentialSyncSettings() {
 const { t } = useTranslation();
 const [settings,setSettings]=useState<sync.CodexCredentialSyncSettings>({enabled:false,serverUrl:''});
 const [serverDraft,setServerDraft]=useState('');
 const [code,setCode]=useState('');const [invite,setInvite]=useState('');const [recoveryCode,setRecoveryCode]=useState('');const [recoveryEnrollment,setRecoveryEnrollment]=useState('');const [pending,setPending]=useState<Pairing[]>([]);
 const [longCode,setLongCode]=useState('');const [confirmReplace,setConfirmReplace]=useState(false);const [showLongCode,setShowLongCode]=useState(false);
 const [accounts,setAccounts]=useState<Array<{id:string;email:string}>>([]);const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const [devices,setDevices]=useState<sync.SyncDevice[]>([]);const [revokeTarget,setRevokeTarget]=useState('');
 const refresh=async()=>{setSettings(await sync.loadCodexCredentialSyncSettings());};
 useEffect(()=>{void sync.loadCodexCredentialSyncSettings().then(s=>{setSettings(s);setServerDraft(s.serverUrl);}).catch(e=>setError(String(e)));void sync.listCodexCredentialSyncAccounts().then(setAccounts).catch(e=>setError(String(e)));},[]);
 useEffect(()=>{if(!settings.enabled)return;const timer=setInterval(()=>{void refresh().catch(()=>undefined);},5000);return()=>clearInterval(timer);},[settings.enabled]);
 const run=async(operation:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await operation();const next=await sync.loadCodexCredentialSyncSettings();setSettings(next);setServerDraft(next.serverUrl);}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <div className="settings-row" style={{alignItems:'flex-start'}}>
  <div className="row-label"><div className="row-title">{t('codex.credentialSync.title')}</div><div className="row-desc">{t('codex.credentialSync.desc')}</div></div>
  <div className="row-control" style={{minWidth:300,display:'flex',flexDirection:'column',alignItems:'stretch',gap:8}}>
   <div style={{display:'flex',gap:6}}><input aria-label={t('codex.credentialSync.server')} className="input input-bordered input-sm" value={serverDraft} placeholder="https://100.100.1.1:18444" disabled={busy||settings.paired} onChange={e=>setServerDraft(e.target.value)}/><button className="btn btn-sm" disabled={busy||settings.paired} onClick={()=>void run(()=>sync.saveCodexCredentialSyncSettings({...settings,serverUrl:sync.normalizeCodexCredentialSyncUrl(serverDraft)}))}>{t('common.save')}</button></div>
   <label><input type="checkbox" checked={settings.enabled} disabled={busy||!settings.serverUrl} onChange={e=>void run(()=>sync.saveCodexCredentialSyncSettings({...settings,enabled:e.target.checked}))}/> {t('codex.credentialSync.enable')}</label>
   <small>{settings.paired?t('codex.credentialSync.paired'):t('codex.credentialSync.unpaired')}</small>
   {!settings.paired&&<div style={{display:'flex',gap:6}}><input aria-label={t('codex.credentialSync.enrollment')} className="input input-bordered input-sm" value={code} placeholder={t('codex.credentialSync.enrollment')} type="password" autoComplete="off" disabled={busy} onChange={e=>setCode(e.target.value)}/><button className="btn btn-sm" disabled={busy||!code.trim()} onClick={()=>void run(async()=>{await sync.saveCodexCredentialSyncSettings({...settings,serverUrl:sync.normalizeCodexCredentialSyncUrl(serverDraft)});await sync.enrollCodexCredentialSyncDevice(code.trim());setCode('');})}>{t('codex.credentialSync.enroll')}</button></div>}
   {settings.paired&&<>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <button className="btn btn-sm" disabled={busy||!settings.enabled} onClick={()=>void run(async()=>setLongCode(await sync.manageCodexCredentialSyncPairingCode()))}>{t('codex.credentialSync.longCode', '获取长期配对码')}</button>
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
    <select aria-label={t('codex.credentialSync.account')} className="select select-bordered select-sm" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('codex.credentialSync.account')}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select>
    <div style={{display:'flex',gap:6}}><button className="btn btn-sm" disabled={busy||!selected} onClick={()=>void run(async()=>{await sync.manualUploadCodexCredential(selected);setMessage(t('codex.credentialSync.uploaded'));})}>{t('codex.credentialSync.upload')}</button><button className="btn btn-sm" disabled={busy||!selected} onClick={()=>void run(async()=>{const ok=await sync.manualSyncCodexCredential(selected);setMessage(t(ok?'codex.credentialSync.recovered':'codex.credentialSync.exhausted'));})}>{t('codex.credentialSync.recover')}</button></div>
    </details>
   </>}
   {!!settings.pendingUploads?.length&&<small>{t('codex.credentialSync.pending',{count:settings.pendingUploads.length})}</small>}
   {selected&&settings.recoveryStatus?.[selected]&&<small>{settings.recoveryStatus[selected]}</small>}
   {settings.paired?<button className="btn btn-sm" disabled={busy} onClick={()=>void run(async()=>{setRecoveryCode(await sync.exportCodexCredentialSyncRecovery());})}>{t('codex.credentialSync.exportRecovery')}</button>:<>
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
