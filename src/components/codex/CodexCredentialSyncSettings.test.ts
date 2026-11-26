import assert from 'node:assert/strict';
import test from 'node:test';
import { loadHookModule, settlePromises } from '../../../tests/helpers/reactHookHarness';

type El = {type: string; props: {children?: unknown; value?: string; readOnly?: boolean; disabled?: boolean; role?: string; 'aria-label'?: string; onChange?: (e: {target: {value:string;checked?:boolean}})=>void; onClick?: ()=>void}};
const elements = (n:unknown): El[] => Array.isArray(n)?n.flatMap(elements):n&&typeof n==='object'?[n as El,...elements((n as El).props?.children)]:[];
function harness(paired=false){
 let settings={enabled:paired,serverUrl:'https://example.test',paired,deviceId:'device-a'};
 const calls:Array<[string,unknown]>=[];let failSave=false;
 const api={
  loadCodexCredentialSyncSettings:async()=>settings,
  saveCodexCredentialSyncSettings:async(s:typeof settings)=>{calls.push(['save',s]);if(failSave)throw new Error('save failed');settings=s;return s;},
  listCodexCredentialSyncAccounts:async()=>[{id:'account-a',email:'a@example.test'}],
  syncAccountDisplayName:(account:{email:string;accountName?:string})=>account.accountName?`${account.accountName} (${account.email})`:account.email,
  manualUploadCodexCredential:async(id:string)=>{calls.push(['upload',id]);},
  manualSyncCodexCredential:async(id:string)=>{calls.push(['recover',id]);return true;},
  normalizeCodexCredentialSyncUrl:(s:string)=>s.trim().replace(/\/+$/,''),
  enrollCodexCredentialSyncDevice:async(code:string)=>{calls.push(['enroll',code]);return settings;},
  restoreCodexCredentialSyncRecovery:async(code:string,recovery:string)=>{calls.push(['restore',{code,recovery}]);settings={...settings,paired:true};return settings;},
  exportCodexCredentialSyncRecovery:async()=>{calls.push(['export',null]);return 'recovery-secret-fixture';},
 };
 const h=loadHookModule(new URL('./CodexCredentialSyncSettings.tsx',import.meta.url),{'react-i18next':{useTranslation:()=>({t:(s:string)=>s})},'../../services/codexCredentialSyncService':api},{setInterval:()=>1,clearInterval:()=>undefined});
 h.render(()=>h.exports.CodexCredentialSyncSettings());
 const find=(label:string)=>{const e=elements(h.flush()).find(x=>x.props?.['aria-label']===label);assert.ok(e,label);return e;};
 const click=(label:string)=>{const e=elements(h.flush()).find(x=>x.type==='button'&&x.props.children===label);assert.ok(e,label);assert.equal(!!e.props.disabled,false);e.props.onClick!();};
 return {h,calls,find,click,fail:()=>{failSave=true;}};
}
test('registration saves the current server draft before invoking native enrollment',async()=>{
 const x=harness();await settlePromises();x.h.flush();
 x.find('codex.credentialSync.server').props.onChange!({target:{value:'https://new.example.test/'}});
 x.find('codex.credentialSync.enrollment').props.onChange!({target:{value:'one-time-code'}});x.h.flush();
 x.click('codex.credentialSync.enroll');await settlePromises();x.h.flush();
 assert.equal(x.calls[0][0],'save');assert.equal((x.calls[0][1] as {serverUrl:string}).serverUrl,'https://new.example.test');assert.deepEqual(x.calls[1],['enroll','one-time-code']);
 assert.equal(x.find('codex.credentialSync.enrollment').props.value,'');x.h.unmount();
});
test('failed enrollment configuration keeps the code and exposes a useful error',async()=>{
 const x=harness();await settlePromises();x.h.flush();x.fail();x.find('codex.credentialSync.enrollment').props.onChange!({target:{value:'keep-code'}});x.h.flush();x.click('codex.credentialSync.enroll');await settlePromises();
 const output=x.h.flush();assert.equal(x.find('codex.credentialSync.enrollment').props.value,'keep-code');assert.ok(elements(output).some(e=>e.props.role==='alert'));assert.equal(x.calls.filter(c=>c[0]==='enroll').length,0);x.h.unmount();
});
test('an unpaired device can enter an offline recovery code and clears it after success',async()=>{
 const x=harness();await settlePromises();x.h.flush();assert.equal(x.find('codex.credentialSync.recoveryCode').props.readOnly,false);
 x.find('codex.credentialSync.recoveryCode').props.onChange!({target:{value:'offline-recovery-fixture'}});x.find('codex.credentialSync.recoveryEnrollment').props.onChange!({target:{value:'enrollment-fixture'}});x.h.flush();x.click('codex.credentialSync.restoreRecovery');await settlePromises();
 assert.deepEqual(x.calls.find(c=>c[0]==='restore'),['restore',{code:'enrollment-fixture',recovery:'offline-recovery-fixture'}]);assert.ok(!elements(x.h.flush()).some(e=>e.props.value==='offline-recovery-fixture'));x.h.unmount();
});
test('recovery keys are not requested until the user explicitly exports them',async()=>{
 const x=harness(true);await settlePromises();x.h.flush();assert.equal(x.calls.length,0);x.click('codex.credentialSync.exportRecovery');await settlePromises();assert.equal(x.find('codex.credentialSync.recoveryCode').props.value,'recovery-secret-fixture');x.h.unmount();
});
test('account row actions address the account directly without a selection dropdown',async()=>{
 const x=harness(true);await settlePromises();const output=x.h.flush();
 assert.ok(!elements(output).some(e=>e.type==='select'));
 const upload=elements(output).find(e=>e.type==='button'&&e.props['aria-label']==='codex.credentialSync.upload a@example.test');
 assert.ok(upload);upload.props.onClick!();await settlePromises();x.h.flush();
 assert.deepEqual(x.calls.find(c=>c[0]==='upload'),['upload','account-a']);
 const recover=elements(x.h.flush()).find(e=>e.type==='button'&&e.props['aria-label']==='codex.credentialSync.recover a@example.test');
 assert.ok(recover);recover.props.onClick!();await settlePromises();x.h.flush();
 assert.deepEqual(x.calls.find(c=>c[0]==='recover'),['recover','account-a']);
 assert.ok(elements(x.h.flush()).some(e=>e.props.role==='tooltip'));
 x.h.unmount();
});
