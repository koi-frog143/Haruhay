import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from './registrationApi'
import { getWorkspaceSession, signOutWorkspace } from './workspaceSession'
import { downloadCsv } from './previewStore'
import { clearVisitorRecords, loadVisitorRecords, philippineDate, philippineTime, philippineToday, visitLabel, visitLabels } from './visitorApi'
import type { Host,LogProperty,SharedPass,VisitorRecord,VisitState } from './visitorApi'
import AdminLayout from './AdminLayout'
import ResidentLayout from './ResidentLayout'
import ResidentDialog from './ResidentDialog'
import { useFormFeedback } from './FormFeedback'
import { ShareVisitorLink, VisitorPassCard } from './GuestVisitorPass'
import logo from './landing-artwork.json'
const VisitorScanner=lazy(()=>import('./VisitorScanner'))
import './LiveLogbook.css'

type Outcome={allowed:boolean;message?:string;record?:VisitorRecord}
type Guard={id:string;email:string;full_name:string;can_review:boolean;enabled:boolean}
type History={event:string;occurred_at:string;actor:string;reason:string|null}
const queueIcons={PENDING:'icon-users-metric.svg',EXPECTED:'icon-book-nav.svg',CHECKED_IN:'icon-user-nav.svg',CHECKED_OUT:'icon-shield.svg'}
const message=(e:unknown)=>e instanceof Error?e.message:'Unable to save. Check your connection and try again.'
function Frame({staff,guard,notice,setNotice,children}:{staff:boolean;guard:boolean;notice:string;setNotice:(s:string)=>void;children:ReactNode}){
  if(guard)return <main className="guard-shell"><header className="guard-header">
    <div className="guard-brand"><img src={logo.HaruhayFinalWebFallbackWordmark} width="156" height="42" alt="Haruhay"/><strong>Front desk</strong></div>
    <div><span>{getWorkspaceSession()?.account.full_name}</span><button className="admin-secondary" onClick={()=>void signOutWorkspace().catch(e=>setNotice(message(e)))}>Sign out</button></div>
  </header>{notice&&<div className="ux-toast" role="status">{notice}<button className="admin-link-button" onClick={()=>setNotice('')}>Dismiss</button></div>}{children}</main>
  return staff?<AdminLayout active="Visitor logbook" node="18:2055" notice={notice} onDismissNotice={()=>setNotice('')}>{children}</AdminLayout>:<ResidentLayout activeSection="Logbook" breadcrumb="Logbook" notice={notice} onNotice={setNotice} onDismissNotice={()=>setNotice('')}>{children}</ResidentLayout>
}
export default function LiveLogbook({staff=false,register=false,residentId=''}:{staff?:boolean;register?:boolean;residentId?:string}){
  const account=getWorkspaceSession()!.account,guard=account.role==='GUARD'
  const [properties,setProperties]=useState<LogProperty[]>([]),[property,setProperty]=useState(''),[records,setRecords]=useState<VisitorRecord[]>([]),[hosts,setHosts]=useState<Host[]>([])
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState<VisitState|''>('')
  const [declining,setDeclining]=useState(false)
  const [dialog,setDialog]=useState<'scan'|'request'|'walkin'|'verify'|'pass'|'review'|'amend'|'guards'|'history'|'activity'|'cancel'|null>(register?'request':null),[selected,setSelected]=useState<VisitorRecord|null>(null)
  const [scanToken,setScanToken]=useState(''),[pass,setPass]=useState<SharedPass|null>(null),[passAction,setPassAction]=useState<'replace'|'revoke'|null>(null),[guards,setGuards]=useState<Guard[]>([]),[history,setHistory]=useState<History[]>([])
  const [propertyRetry,setPropertyRetry]=useState(0)
  const searchInput=useRef<HTMLInputElement>(null)
  const resultsHeading=useRef<HTMLHeadingElement>(null)
  const declineReason=useRef<HTMLTextAreaElement>(null)
  const scope=useRef(0),current=useRef(account.id+':'+property)
  useEffect(()=>{current.current=account.id+':'+property;return()=>{current.current='closed'}},[account.id,property])
  useEffect(()=>{
    let live=true
    if(staff)api<LogProperty[]>('/logbook/properties').then(p=>{if(live){setProperties(p);setProperty(p[0]?.id||'');if(!p.length)setLoading(false)}}).catch(e=>{if(live){setError(message(e));setLoading(false)}})
    return()=>{live=false}
  },[staff,propertyRetry])
  const refresh=useCallback(async()=>{
    if(staff&&!property)return
    const version=++scope.current,key=current.current
    setLoading(true)
    try{const [rows,h]=await Promise.all([loadVisitorRecords(staff?property:undefined),api<Host[]>('/logbook/hosts'+(staff?'?property='+property:''))]);if(version===scope.current&&key===current.current&&rows){setRecords(rows);setHosts(h);setError('')}}catch(e){if(version===scope.current)setError(message(e))}finally{if(version===scope.current)setLoading(false)}
  },[staff,property])
  useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>{clearTimeout(timer)}},[refresh])
  useEffect(()=>{if(dialog==='review'&&declining)declineReason.current?.focus()},[dialog,declining])
  function close(){setDialog(null);setSelected(null);setPass(null);setScanToken('');setPassAction(null);setError('')}
  async function run(action:()=>Promise<void>){const key=current.current;setBusy(true);setError('');try{await action();if(current.current===key)await refresh()}catch(e){if(current.current===key)setError(message(e))}finally{if(current.current===key)setBusy(false)}}
  const scan=useCallback((token:string)=>{
    const key=current.current;setBusy(true);setError('')
    api<Outcome>('/logbook/properties/'+property+'/scan',{token}).then(result=>{if(current.current!==key)return;if(!result.allowed)throw new Error(result.message);setSelected(result.record!);setScanToken(token);setDialog('verify')}).catch(e=>{if(current.current===key)setError(message(e))}).finally(()=>{if(current.current===key)setBusy(false)})
  },[property])
  const canReview=!staff||account.role==='OWNER'||properties.find(p=>p.id===property)?.can_review===true
  const scoped=records.filter(r=>!residentId||r.host_application_id===residentId)
  const visible=scoped.filter(r=>(!filter||r.display_status===filter)&&`${r.full_name} ${r.contact} ${r.host_name} ${r.room_label} ${r.purpose}`.toLowerCase().includes(query.trim().toLowerCase()))
  function open(r:VisitorRecord,type:typeof dialog){setSelected(r);setDialog(type);setDeclining(false);setError('');setScanToken('');setPass(null);setPassAction(null)}
  function focusQueue(state:VisitState){
    setQuery('');setFilter(state)
    requestAnimationFrame(()=>resultsHeading.current?.focus())
  }
  function findGuest(){
    close();setFilter('')
    requestAnimationFrame(()=>searchInput.current?.focus())
  }
  const footer='Saved to property records. All times are Philippine time. Visitor identity must be checked by authorized staff.'
  async function issue(record:VisitorRecord,replace=false){
    await run(async()=>{
      const next=await api<SharedPass>('/logbook/visits/'+record.visit_id+'/pass',{replace})
      setPass(next);setPassAction(null)
      if(replace)setNotice('Pass replaced. Share the new link with your guest.')
    })
  }
  function openPass(record:VisitorRecord){
    open(record,'pass');void issue(record)
  }
  async function review(record:VisitorRecord,action:'APPROVE'|'DECLINE',reason?:FormDataEntryValue|null){
    await run(async()=>{
      await api('/logbook/requests/'+record.id+'/review',{action,reason})
      close();setNotice(action==='APPROVE'?'Visit approved. The resident can share the pass.':'Visit declined. The resident can see your reason.')
    })
  }
  async function viewGuards(){await run(async()=>{setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'));setDialog('guards')})}
  function csv(){downloadCsv('visitor-logbook.csv',[['Visitor','Host','Room','Purpose','Planned date (PHT)','Entry window start (PHT)','Entry window end (PHT)','Status','Actual arrival (PHT)','Actual departure (PHT)'],...visible.map(r=>[r.full_name,r.host_name,r.room_label,r.purpose,r.planned_date||'',philippineTime(r.arrival),philippineTime(r.departure),visitLabel(r),philippineTime(r.checked_in),philippineTime(r.checked_out)])])}
  function visitActions(r:VisitorRecord){
    return <div className="visitor-actions">
      {staff&&canReview&&r.display_status==='PENDING'&&<button className="admin-primary" onClick={()=>open(r,'review')}>Review request</button>}
      {(r.display_status==='EXPECTED'||r.display_status==='CHECKED_IN'&&r.has_shareable_pass)&&<button className={staff?'admin-secondary':'admin-primary'} onClick={()=>openPass(r)}>Share pass</button>}
      {staff&&['EXPECTED','CHECKED_IN'].includes(r.display_status)&&<button className="admin-primary" onClick={()=>open(r,'verify')}>{r.display_status==='EXPECTED'?'Verify check-in':'Verify checkout'}</button>}
      {canReview&&['PENDING','EXPECTED'].includes(r.display_status)&&<button className="admin-secondary" disabled={busy} onClick={()=>open(r,'cancel')}>Cancel visit</button>}
      {!staff&&['CHECKED_OUT','DECLINED','CANCELLED','EXPIRED','VOIDED'].includes(r.display_status)&&<button className="admin-secondary" onClick={()=>open(r,'request')}>Invite again</button>}
      {staff&&r.visit_id&&<><button className="admin-secondary" onClick={()=>void run(async()=>{setHistory(await api<History[]>('/logbook/properties/'+property+'/visits/'+r.visit_id+'/history'));open(r,'history')})}>History</button><button className="admin-secondary" disabled={!canReview} onClick={()=>open(r,'amend')}>Record correction</button></>}
    </div>
  }
  return <Frame staff={staff} guard={guard} notice={notice} setNotice={setNotice}><div className={'visitor-live'+(!staff?' resident-content':'')}>
    <header className="visitor-heading resident-page-heading">
      <div><h1>{staff?'Visitor logbook':'Your logbook'}</h1><p>{staff?'Review visits and confirm arrivals and departures for the selected property.':'Invite a guest, then share their pass when the visit is approved.'}</p></div>
      {!staff&&<button className="admin-primary" onClick={()=>setDialog('request')}>Invite a guest</button>}
    </header>
    {staff&&<>
      <div className="visitor-actions visitor-desk-actions">
        <button className="admin-primary" disabled={!property||busy} onClick={()=>setDialog('scan')}>Scan pass</button>
        <button className="admin-secondary" disabled={!property||busy} onClick={findGuest}>Find guest</button>
        <button className="admin-secondary" disabled={!property||busy} onClick={()=>focusQueue('CHECKED_IN')}>Who’s inside?</button>
        {canReview&&<button className="admin-secondary" disabled={!property||busy} onClick={()=>setDialog('walkin')}>Register walk-in</button>}
      </div>
      <div className="visitor-property-bar">
        <label>Property <select aria-label="Logbook property" disabled={busy} value={property} onChange={e=>{scope.current++;clearVisitorRecords();setRecords([]);setHosts([]);close();setQuery('');setFilter('');setProperty(e.target.value)}}>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="admin-secondary" disabled={!property||busy} onClick={()=>void run(async()=>{setHistory(await api<History[]>('/logbook/properties/'+property+'/activity'));setDialog('activity')})}>Property activity</button>
        {!guard&&<button className="admin-secondary" disabled={!property||busy} onClick={()=>void viewGuards()}>Manage guards</button>}
      </div>
    </>}
    <div className="visitor-metrics" aria-label="Visit queues">{(Object.entries(queueIcons) as [VisitState,string][]).map(([state,icon])=><button type="button" className="visitor-queue" key={state} aria-pressed={filter===state} onClick={()=>filter===state?setFilter(''):focusQueue(state)}><img src={'./assets/dashboard/'+icon} alt=""/><strong>{scoped.filter(r=>r.display_status===state).length}</strong><span>{state==='PENDING'&&staff&&canReview?'Needs review':visitLabels[state]}</span></button>)}</div>
    {error&&!dialog&&<div className="ux-status" data-tone="error" role="alert">{error} <button type="button" className="admin-secondary" onClick={()=>{if(property||!staff)void refresh();else{setError('');setLoading(true);setPropertyRetry(n=>n+1)}}}>Retry loading visits</button></div>}
    {residentId&&<p className="visitor-callout">Showing this resident’s hosted visits. <a href="#/admin/logbook">View all visitors</a></p>}
    <div className="visitor-toolbar">
      <label>Search visitors or hosts<input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, contact, host, room or purpose"/></label>
      <label>Visit status<select value={filter} onChange={e=>setFilter(e.target.value as VisitState|'')}><option value="">All records</option>{Object.entries(visitLabels).map(([state,label])=><option key={state} value={state}>{label}</option>)}</select></label>
      <div className="visitor-actions"><button className="admin-secondary" disabled={!visible.length||loading} onClick={csv}>Export CSV</button><button className="admin-secondary" disabled={loading} onClick={()=>void refresh()}>Refresh</button></div>
    </div>
    <section className="visitor-results" aria-labelledby="visitor-results-heading" aria-busy={loading}>
      <h2 id="visitor-results-heading" tabIndex={-1} ref={resultsHeading}>{staff&&canReview&&filter==='PENDING'?'Needs review':filter==='CHECKED_IN'?'Who’s inside?':'Visits'}</h2>
      {loading?<p role="status">Loading saved logbook…</p>:!visible.length?<div className="visitor-card"><h3>{scoped.length?'No matching visits':'No visits yet'}</h3><p className="visitor-muted">{scoped.length?'Try another search or filter.':staff?'Invitations and walk-ins will appear here.':'Invite a guest to start a visit.'}</p></div>
        :!staff||filter==='PENDING'&&canReview?<div className="visitor-records">{visible.map(r=><article className="visitor-card visitor-record" key={r.id}>
          <header><h3>{r.full_name}</h3><VisitBadge record={r}/></header>
          {staff&&<p>{r.host_name} · {r.room_label}</p>}
          <p>{r.purpose}</p>
          <div className="visitor-muted"><VisitTimes record={r}/></div>
          {r.reason&&<p className="visitor-note">{r.reason}</p>}
          {!staff&&r.display_status==='PENDING'&&<p className="visitor-muted">You can share the pass after staff approve the visit.</p>}
          {!staff&&r.display_status==='CHECKED_IN'&&<p className="visitor-muted">The front desk will confirm when your guest leaves.</p>}
          {staff&&canReview&&filter==='PENDING'?<div className="visitor-actions">
            <button className="admin-primary" disabled={busy} onClick={()=>open(r,'review')}>Approve visit</button>
            <button className="admin-secondary" disabled={busy} onClick={()=>{open(r,'review');setDeclining(true)}}>Decline visit</button>
            <button className="admin-secondary" disabled={busy} onClick={()=>open(r,'cancel')}>Cancel visit</button>
          </div>:visitActions(r)}
        </article>)}</div>
        :<div className="visitor-table"><table role="table" aria-label="Visit records"><thead role="rowgroup"><tr role="row">{['Visitor','Host / room','Visit times','Status','Actions'].map(s=><th key={s} role="columnheader" scope="col">{s}</th>)}</tr></thead><tbody role="rowgroup">{visible.map(r=><tr key={r.id} role="row">
          <td role="cell" data-label="Visitor"><strong>{r.full_name}</strong>{r.contact&&<small>{r.contact}</small>}<small>{r.purpose}</small></td>
          <td role="cell" data-label="Host / room">{r.host_name}<small>{r.room_label}</small></td>
          <td role="cell" data-label="Visit times"><VisitTimes record={r}/></td>
          <td role="cell" data-label="Status"><VisitBadge record={r}/>{r.reason&&<small>{r.reason}</small>}</td>
          <td role="cell" data-label="Actions">{visitActions(r)}</td>
        </tr>)}</tbody></table></div>}
    </section>

  </div>
  {dialog==='cancel'&&selected&&<ResidentDialog title="Cancel this visit?" busy={busy} onClose={close} dismissOnBackdrop={false} footerNote="">
    <p>This will cancel the visit for {selected.full_name} and revoke any issued pass.</p>
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    <div className="visitor-actions"><button className="admin-secondary" onClick={close} disabled={busy}>Keep visit</button>
    <button className="admin-primary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/requests/'+selected.id+'/cancel',{});close();setNotice('Visit cancelled. Any issued pass is revoked.')})}>Confirm cancellation</button></div>
  </ResidentDialog>}
  {dialog==='scan'&&<Suspense fallback={<p role="status">Loading scanner…</p>}><VisitorScanner onClose={close} onSearch={findGuest} onScan={scan} scanError={error} busy={busy}/></Suspense>}
  {(dialog==='request'||dialog==='walkin')&&<ResidentDialog busy={busy} title={dialog==='walkin'?'Register a walk-in':selected?'Invite again':'Invite a guest'} onClose={close} footerNote=""><VisitorForm hosts={hosts} previous={selected} walkin={dialog==='walkin'} busy={busy} error={error} onSubmit={data=>run(async()=>{
    if(dialog==='walkin'){
      const result=await api<{visitId:string}>('/logbook/walk-ins',data)
      const all=await loadVisitorRecords(property)
      const r=all?.find(r=>r.visit_id===result.visitId)
      if(r){setSelected(r);setDialog('verify')}
      setNotice('Walk-in authorized. Check the guest’s ID before confirming check-in.')
    }else{
      await api('/logbook/requests',data)
      close()
      setNotice('Invitation submitted for approval.')
      if(register)window.location.hash='/resident/logbook'
    }
  })}/></ResidentDialog>}
  {dialog==='review'&&selected&&<ResidentDialog busy={busy} title="Review visit" onClose={close} footerNote=""><Summary record={selected}/>
    <p className="visitor-callout">{selected.planned_date?'Entry is allowed on the planned date in Philippine time.':selected.window_policy==='LEGACY'?'This visit keeps its requested entry window.':'Your approval opens entry for 24 hours.'}</p>
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    {declining?<form className="visitor-form" onSubmit={e=>{e.preventDefault();void review(selected,'DECLINE',new FormData(e.currentTarget).get('reason'))}}>
      <label>Reason for declining<textarea ref={declineReason} name="reason" required maxLength={1000} placeholder="The resident will see this reason."/></label>
      <div className="visitor-actions"><button className="admin-primary" disabled={busy}>Decline visit</button><button className="admin-secondary" type="button" disabled={busy} onClick={()=>{setDeclining(false);setError('')}}>Back to review</button></div>
    </form>:<div className="visitor-actions"><button className="admin-primary" disabled={busy} onClick={()=>void review(selected,'APPROVE')}>Approve visit</button><button className="admin-secondary" disabled={busy} onClick={()=>{setDeclining(true);setError('')}}>Decline visit</button></div>}
  </ResidentDialog>}
  {dialog==='pass'&&selected&&<ResidentDialog busy={busy} title="Share pass" onClose={close} footerNote="">
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    {pass?<><VisitorPassCard key={pass.token} pass={pass}/><ShareVisitorLink key={pass.shareToken} url={new URL('#/visitor-pass/'+pass.shareToken,window.location.href).href}/></>:<p role="status">{busy?'Opening pass…':'The pass is unavailable.'}</p>}
    {!passAction&&<div className="visitor-actions">
      {!pass&&<button className="admin-secondary" disabled={busy} onClick={()=>void issue(selected)}>Retry opening pass</button>}
      {selected.display_status==='EXPECTED'&&<button className="admin-secondary" disabled={busy} onClick={()=>{setPassAction('replace');setError('')}}>Replace pass</button>}
      {pass&&canReview&&<button className="admin-secondary" disabled={busy} onClick={()=>{setPassAction('revoke');setError('')}}>Revoke pass</button>}
    </div>}
    {passAction==='replace'&&<div className="visitor-form"><p className="visitor-callout">The current link and QR will stop working. Share the new pass with your guest.</p><div className="visitor-actions"><button className="admin-primary" disabled={busy} onClick={()=>void issue(selected,true)}>Confirm replacement</button><button className="admin-secondary" disabled={busy} onClick={()=>setPassAction(null)}>Keep current pass</button></div></div>}
    {passAction==='revoke'&&<form className="visitor-form" onSubmit={e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get('reason');void run(async()=>{await api('/logbook/visits/'+selected.visit_id+'/pass/revoke',{reason});close();setNotice('Pass revoked. The front desk can still check out an open visit.')})}}>
      <label>Reason for revoking<textarea name="reason" required maxLength={1000}/></label><div className="visitor-actions"><button className="admin-primary" disabled={busy}>Confirm revocation</button><button type="button" className="admin-secondary" disabled={busy} onClick={()=>setPassAction(null)}>Keep current pass</button></div>
    </form>}
  </ResidentDialog>}
  {dialog==='verify'&&selected&&<ResidentDialog busy={busy} title={selected.visit_status==='CHECKED_IN'?'Confirm checkout':'Verify check-in'} eyebrow={scanToken?'PASS VERIFIED':'MANUAL VERIFICATION'} onClose={close} footerNote={footer}><Summary record={selected}/><form className="visitor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{const result=await api<Outcome>('/logbook/properties/'+property+'/visits/'+selected.visit_id+'/movement',{action:selected.visit_status==='CHECKED_IN'?'EXIT':'ENTRY',method:scanToken?'QR':'MANUAL',token:scanToken||null,identityConfirmed:f.get('identity')==='on',idType:f.get('idType')||null,idLastFour:f.get('idLastFour')||null,reason:f.get('reason')||null});if(!result.allowed)throw new Error(result.message);close();setNotice(result.message||'Movement saved.')})}}>{selected.visit_status!=='CHECKED_IN'&&<><label>ID type<input name="idType" required maxLength={80} placeholder="e.g. Driver’s license"/></label><label>Last four ID characters (optional)<input name="idLastFour" maxLength={4} pattern="[A-Za-z0-9]{4}" autoComplete="off"/></label><label className="visitor-check"><input type="checkbox" name="identity" required/>I checked the visitor’s presented identity against this record.</label></>}{!scanToken&&<label>Manual verification reason<textarea name="reason" required maxLength={1000} placeholder="Explain how the visit was identified and verified."/></label>}{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Confirm {selected.visit_status==='CHECKED_IN'?'checkout':'check-in'}</button></form></ResidentDialog>}
  {dialog==='amend'&&selected&&<ResidentDialog busy={busy} title="Record an audited change" eyebrow="HISTORY IS RETAINED" onClose={close} footerNote={footer}><Summary record={selected}/><form className="visitor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{await api('/logbook/properties/'+property+'/visits/'+selected.visit_id+'/amend',{action:f.get('action'),reason:f.get('reason')});close();setNotice('Change recorded in visit history.')})}}><label>Action<select name="action"><option value="CORRECTION">Append correction note</option><option value="REVOKE">Revoke pass (open checkout remains available)</option><option value="VOID">Void record (retain entry and exit evidence)</option></select></label><label>Reason<textarea name="reason" required maxLength={1000}/></label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Record change</button></form></ResidentDialog>}
  {(dialog==='activity'||dialog==='history'&&selected)&&<ResidentDialog busy={busy} title={dialog==='activity'?'Recent property activity':'Visit activity history'} eyebrow={dialog==='activity'?'LATEST 250 AUDIT EVENTS':selected!.full_name} onClose={close} footerNote={footer}>{history.map((h,i)=><article className="visitor-card" key={i}><strong>{h.event.replaceAll('_',' ')}</strong><p>{h.actor} · {philippineTime(h.occurred_at)}</p>{h.reason&&<p className="visitor-note">{h.reason}</p>}</article>)}</ResidentDialog>}
  {dialog==='guards'&&<ResidentDialog busy={busy} title="Property guards" eyebrow="NARROW LOGBOOK ACCESS" onClose={close} footerNote="Dedicated guard accounts access only the assigned property’s logbook. Credentials must be shared privately; this form sends no email."><div className="visitor-form">{guards.map(g=><article className="visitor-card" key={g.id}><strong>{g.full_name}</strong><p>{g.email}</p><div className="visitor-actions"><button className="admin-secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/properties/'+property+'/guards/'+g.id,{enabled:!g.enabled,canReview:g.can_review});setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'))})}>{g.enabled?'Disable':'Enable'}</button><button className="admin-secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/properties/'+property+'/guards/'+g.id,{enabled:g.enabled,canReview:!g.can_review});setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'))})}>{g.can_review?'Remove review permission':'Allow request review'}</button></div></article>)}<form className="visitor-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);void run(async()=>{await api('/logbook/properties/'+property+'/guards',{fullName:f.get('fullName'),email:f.get('email'),password:f.get('password'),canReview:f.get('canReview')==='on'});form.reset();setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'));setNotice('Guard account created. No email was sent.')})}}><h2>Add a guard</h2><label>Full name<input name="fullName" required maxLength={100}/></label><label>Dedicated staff email<input type="email" name="email" required maxLength={254}/></label><label>Initial password<input type="password" name="password" required minLength={12} maxLength={72} autoComplete="new-password"/></label><label className="visitor-check"><input name="canReview" type="checkbox"/>Can approve or decline visitor requests and authorize walk-ins</label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Create guard account</button></form></div></ResidentDialog>}
  </Frame>
}
function VisitBadge({record}:{record:VisitorRecord}){
  return <span className={'visitor-status state-'+record.display_status.toLowerCase()}>{visitLabel(record)}</span>
}

function VisitTimes({record:r}:{record:VisitorRecord}){
  return <div className="visitor-times">
    {r.planned_date&&<span>Planned for {philippineDate(r.planned_date)}</span>}
    {r.arrival&&r.departure&&<span>Entry window: {philippineTime(r.arrival)} to {philippineTime(r.departure)}</span>}
    {r.checked_in&&<span>Arrived {philippineTime(r.checked_in)}</span>}
    {r.checked_out&&<span>Left {philippineTime(r.checked_out)}</span>}
  </div>
}

function Summary({record:r}:{record:VisitorRecord}){
  return <dl className="visitor-summary">
    <div><dt>Guest</dt><dd>{r.full_name}</dd></div>
    <div><dt>Host / room</dt><dd>{r.host_name} / {r.room_label}</dd></div>
    <div><dt>Purpose</dt><dd>{r.purpose}</dd></div>
    <div><dt>Status</dt><dd><VisitBadge record={r}/></dd></div>
    {(r.planned_date||r.arrival||r.checked_in)&&<div className="visitor-summary-times"><dt>Visit times (PHT)</dt><dd><VisitTimes record={r}/></dd></div>}
  </dl>
}

function VisitorForm({hosts,previous,walkin,busy,error,onSubmit}:{hosts:Host[];previous:VisitorRecord|null;walkin:boolean;busy:boolean;error:string;onSubmit:(data:object)=>Promise<void>}){
  const [tenancyId,setTenancyId]=useState(previous?.tenancy_id||'')
  const [schedule,setSchedule]=useState(false)
  const feedback=useFormFeedback()
  const today=philippineToday()
  const chosenHost=hosts.some(host=>host.id===tenancyId)?tenancyId:hosts.length===1?hosts[0].id:''
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form=event.currentTarget
    const fields=new FormData(form)
    const plannedDate=String(fields.get('plannedDate')||'')
    const contact=String(fields.get('contact')||'').trim()
    const issues=[]
    if(contact&&(!/^[+()0-9 -]{7,30}$/.test(contact)||contact.replace(/[^0-9]/g,'').length<7))
      issues.push({name:'contact',label:'Contact number',message:'Enter a valid number or leave this blank.'})
    if(!feedback.validate(form,issues))return

    const visitor={tenancyId:chosenHost,fullName:fields.get('fullName'),contact,purpose:fields.get('purpose'),plannedDate:plannedDate||null}
    void onSubmit(walkin?{visitor,hostAuthorized:fields.get('hostAuthorized')==='on',reason:fields.get('reason')}:visitor)
  }
  return <form className="visitor-form" noValidate onSubmit={submit} onChange={e=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement) feedback.clear(e.target.name)
  }}>
    <p className="visitor-muted">Enter the guest’s name as it appears on their ID.</p>
    {feedback.summary}
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    <label>Guest name<input name="fullName" required maxLength={100} defaultValue={previous?.full_name} {...feedback.fieldProps('fullName')}/>{feedback.fieldError('fullName')}</label>
    <label>Purpose of visit<input name="purpose" required maxLength={500} defaultValue={previous?.purpose} {...feedback.fieldProps('purpose')}/>{feedback.fieldError('purpose')}</label>
    <label>Contact number (optional)<input name="contact" type="tel" maxLength={30} defaultValue={previous?.contact} {...feedback.fieldProps('contact')}/>{feedback.fieldError('contact')}</label>
    {(walkin||hosts.length>1)&&<label>Host / room<select name="tenancyId" required value={chosenHost} onChange={e=>setTenancyId(e.target.value)} {...feedback.fieldProps('tenancyId')}><option value="" disabled>Select active host</option>{hosts.map(h=><option value={h.id} key={h.id}>{h.full_name} · {h.property_name} / {h.label}</option>)}</select>{feedback.fieldError('tenancyId')}</label>}
    {!hosts.length&&<p role="alert">No active hosts available. An active tenancy is required.</p>}
    {!walkin&&<div className="visitor-schedule">
      <button className="admin-link-button" type="button" aria-expanded={schedule} aria-controls="visitor-planned-date" onClick={()=>{setSchedule(!schedule);feedback.clear('plannedDate')}}>Planning for another day?</button>
      <div id="visitor-planned-date">{schedule&&<label>Visit date (optional, Philippine time)<input name="plannedDate" type="date" min={today} {...feedback.fieldProps('plannedDate')}/>{feedback.fieldError('plannedDate')}</label>}</div>
    </div>}
    {walkin&&<>
      <label className="visitor-check"><input type="checkbox" required name="hostAuthorized" {...feedback.fieldProps('hostAuthorized')}/>I confirmed this visit with the active host.</label>{feedback.fieldError('hostAuthorized')}
      <label>Host authorization details<textarea name="reason" required maxLength={1000} {...feedback.fieldProps('reason')}/>{feedback.fieldError('reason')}</label>
    </>}
    <p className="visitor-callout">{walkin?'Next, check the visitor’s ID and confirm check-in.':schedule?'Staff review the invitation. If you choose a date, the pass allows entry that day after approval.':'Staff review the invitation. Once approved, your guest has 24 hours to check in.'}</p>
    <button className="admin-primary" disabled={busy||!hosts.length}>{busy?'Saving…':walkin?'Authorize walk-in':'Send invitation'}</button>
  </form>
}
