import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from './registrationApi'
import { getWorkspaceSession, signOutWorkspace } from './workspaceSession'
import { downloadCsv } from './previewStore'
import { clearVisitorRecords, loadVisitorRecords, localInput, philippineTime, visitLabel } from './visitorApi'
import type { Host,LogProperty,VisitorRecord } from './visitorApi'
import AdminLayout from './AdminLayout'
import ResidentLayout from './ResidentLayout'
import ResidentDialog from './ResidentDialog'
import { useFormFeedback } from './FormFeedback'
import logo from './landing-artwork.json'
const VisitorScanner=lazy(()=>import('./VisitorScanner'))
import './LiveLogbook.css'

type Outcome={allowed:boolean;message?:string;record?:VisitorRecord}
type Guard={id:string;email:string;full_name:string;can_review:boolean;enabled:boolean}
type History={event:string;occurred_at:string;actor:string;reason:string|null}
const message=(e:unknown)=>e instanceof Error?e.message:'Unable to save. Check your connection and try again.'
function Frame({staff,guard,notice,setNotice,children}:{staff:boolean;guard:boolean;notice:string;setNotice:(s:string)=>void;children:ReactNode}){
  if(guard)return <main className="guard-shell"><header className="guard-header"><div className="guard-brand"><img src={logo.HaruhayFinalWebFallbackMark} width="42" height="42" alt=""/><strong>Haruhay · Front desk</strong></div><div><span>{getWorkspaceSession()?.account.full_name}</span><button className="admin-secondary" onClick={()=>void signOutWorkspace().catch(e=>setNotice(message(e)))}>Sign out</button></div></header>{notice&&<div className="ux-toast" role="status">{notice}<button className="admin-link-button" onClick={()=>setNotice('')}>Dismiss</button></div>}{children}</main>
  return staff?<AdminLayout active="Visitor logbook" node="18:2055" notice={notice} onDismissNotice={()=>setNotice('')}>{children}</AdminLayout>:<ResidentLayout activeSection="Logbook" breadcrumb="Logbook" notice={notice} onNotice={setNotice} onDismissNotice={()=>setNotice('')}>{children}</ResidentLayout>
}
export default function LiveLogbook({staff=false,register=false,residentId=''}:{staff?:boolean;register?:boolean;residentId?:string}){
  const account=getWorkspaceSession()!.account,guard=account.role==='GUARD'
  const [properties,setProperties]=useState<LogProperty[]>([]),[property,setProperty]=useState(''),[records,setRecords]=useState<VisitorRecord[]>([]),[hosts,setHosts]=useState<Host[]>([])
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState('')
  const [decision,setDecision]=useState<'APPROVE'|'DECLINE'>('APPROVE')
  const [dialog,setDialog]=useState<'scan'|'request'|'walkin'|'verify'|'pass'|'review'|'amend'|'guards'|'history'|'activity'|'cancel'|null>(register?'request':null),[selected,setSelected]=useState<VisitorRecord|null>(null)
  const [scanToken,setScanToken]=useState(''),[pass,setPass]=useState<{token:string;expiresAt:string}|null>(null),[qr,setQr]=useState(''),[replace,setReplace]=useState(false),[guards,setGuards]=useState<Guard[]>([]),[history,setHistory]=useState<History[]>([])
  const [propertyRetry,setPropertyRetry]=useState(0)
  const searchInput=useRef<HTMLInputElement>(null)
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
  useEffect(()=>{
    let live=true
    if(pass)import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(pass.token,{scale:8,errorCorrectionLevel:'M',margin:4})).then(url=>{if(live)setQr(url)}).catch(e=>{if(live)setError(message(e))})
    return()=>{live=false}
  },[pass])
  function close(){setDialog(null);setSelected(null);setPass(null);setQr('');setScanToken('');setReplace(false);setError('')}
  async function run(action:()=>Promise<void>){const key=current.current;setBusy(true);setError('');try{await action();if(current.current===key)await refresh()}catch(e){if(current.current===key)setError(message(e))}finally{if(current.current===key)setBusy(false)}}
  const scan=useCallback((token:string)=>{
    const key=current.current;setBusy(true);setError('')
    api<Outcome>('/logbook/properties/'+property+'/scan',{token}).then(result=>{if(current.current!==key)return;if(!result.allowed)throw new Error(result.message);setSelected(result.record!);setScanToken(token);setDialog('verify')}).catch(e=>{if(current.current===key)setError(message(e))}).finally(()=>{if(current.current===key)setBusy(false)})
  },[property])
  const canReview=!staff||account.role==='OWNER'||properties.find(p=>p.id===property)?.can_review===true
  const visible=records.filter(r=>(!residentId||r.host_application_id===residentId)&&(!filter||(r.visit_status||r.status)===filter)&&`${r.full_name} ${r.contact} ${r.host_name} ${r.room_label} ${r.purpose}`.toLowerCase().includes(query.trim().toLowerCase()))
  function open(r:VisitorRecord,type:typeof dialog){setSelected(r);setDialog(type);setDecision('APPROVE');setError('');setScanToken('');setPass(null);setQr('')}
  const footer='Saved to property records. All times are Philippine time. Visitor identity must be checked by authorized staff.'
  async function issue(){if(!selected?.visit_id)return;await run(async()=>{const next=await api<{token:string;expiresAt:string}>('/logbook/visits/'+selected.visit_id+'/pass',{replace});setPass(next);setQr('')})}
  async function viewGuards(){await run(async()=>{setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'));setDialog('guards')})}
  function csv(){downloadCsv('visitor-logbook.csv',[['Visitor','Host','Room','Purpose','Arrival (PHT)','Departure (PHT)','Status','Entry (PHT)','Exit (PHT)'],...visible.map(r=>[r.full_name,r.host_name,r.room_label,r.purpose,philippineTime(r.arrival),philippineTime(r.departure),visitLabel(r),philippineTime(r.checked_in),philippineTime(r.checked_out)])])}
  return <Frame staff={staff} guard={guard} notice={notice} setNotice={setNotice}><div className={'visitor-live'+(!staff?' resident-content':'')}>
    <header className="visitor-heading resident-page-heading"><div><span className="visitor-muted">{staff?'SITE ENTRY MONITORING':'VISITORS AND ACCESS'}</span><h1>{staff?'Visitor logbook':'Your logbook'}</h1><p>{staff?'Review requests and confirm safe, verified arrivals and departures.':'Invite your guests and follow their visit, from approval to departure.'}</p></div><div className="visitor-actions">{staff&&<button className="admin-primary" disabled={!property||busy} onClick={()=>setDialog('scan')}>Scan QR</button>}<button className={staff ? 'admin-secondary' : 'admin-primary'} disabled={staff&&(!property||!canReview)} onClick={()=>setDialog(staff?'walkin':'request')}>{staff?'Register walk-in':'Add visitor'}</button></div></header>
    {staff&&<div className="visitor-property-bar"><label>Property <select aria-label="Logbook property" disabled={busy} value={property} onChange={e=>{scope.current++;clearVisitorRecords();setRecords([]);setHosts([]);close();setProperty(e.target.value)}}>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="admin-secondary" disabled={!property||busy} onClick={()=>void run(async()=>{setHistory(await api<History[]>('/logbook/properties/'+property+'/activity'));setDialog('activity')})}>Property activity</button>{!guard&&<button className="admin-secondary" disabled={!property||busy} onClick={()=>void viewGuards()}>Manage guards</button>}</div>}
    <div className="visitor-metrics" aria-label="Visit queues">{[{status:'PENDING',label:'Pending requests',value:records.filter(r=>r.status==='PENDING').length,icon:'icon-users-metric.svg'},{status:'EXPECTED',label:'Expected visits',value:records.filter(r=>r.visit_status==='EXPECTED'&&!r.voided).length,icon:'icon-book-nav.svg'},{status:'CHECKED_IN',label:'Visitors inside',value:records.filter(r=>r.visit_status==='CHECKED_IN').length,icon:'icon-user-nav.svg'},{status:'CHECKED_OUT',label:'Completed visits',value:records.filter(r=>r.visit_status==='CHECKED_OUT').length,icon:'icon-shield.svg'}].map(m=><button type="button" className="visitor-queue" key={m.label} aria-pressed={filter===m.status} onClick={()=>setFilter(filter===m.status?'':m.status)}><img src={'./assets/dashboard/'+m.icon} alt=""/><strong>{m.value}</strong><span>{m.label}</span></button>)}</div>
    {error&&!dialog&&<div className="ux-status" data-tone="error" role="alert">{error} <button type="button" className="admin-secondary" onClick={()=>{if(property||!staff)void refresh();else{setError('');setLoading(true);setPropertyRetry(n=>n+1)}}}>Retry loading visits</button></div>}
    {residentId&&<p className="visitor-callout">Showing this resident’s hosted visits. <a href="#/admin/logbook">View all visitors</a></p>}<div className="visitor-toolbar"><label>Search visitors or hosts<input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, contact, host, room or purpose"/></label><label>Visit status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All records</option>{['PENDING','EXPECTED','CHECKED_IN','CHECKED_OUT','DECLINED','CANCELLED'].map(s=><option key={s} value={s}>{({PENDING:'Pending review',EXPECTED:'Expected',CHECKED_IN:'Checked in',CHECKED_OUT:'Checked out',DECLINED:'Declined',CANCELLED:'Cancelled'} as Record<string,string>)[s]}</option>)}</select></label><div className="visitor-actions"><button className="admin-secondary" disabled={!visible.length||loading} onClick={csv}>Export CSV</button><button className="admin-secondary" disabled={loading} onClick={()=>void refresh()}>Refresh</button></div></div>
    {loading?<p role="status">Loading saved logbook…</p>:!visible.length?<section className="visitor-card"><h2>{records.length?'No matching visits':'No visitor records yet'}</h2><p className="visitor-muted">{records.length?'Try another search or filter.':'Requests appear here after submission. Approval does not check a visitor in.'}</p></section>:<div className="visitor-table"><table role="table" aria-label="Visit records"><thead role="rowgroup"><tr role="row">{['Visitor','Host / room','Approved visit window','Status','Actions'].map(s=><th key={s} role="columnheader" scope="col">{s}</th>)}</tr></thead><tbody role="rowgroup">{visible.map(r=><tr key={r.id} role="row"><td role="cell" data-label="Visitor"><strong>{r.full_name}</strong><small>{r.contact}</small><small>{r.purpose}</small></td><td role="cell" data-label="Host / room">{r.host_name}<small>Room {r.room_label}</small></td><td role="cell" data-label="Visit times">{philippineTime(r.arrival)}<small>Until {philippineTime(r.departure)}</small>{r.checked_in&&<small>Entry: {philippineTime(r.checked_in)}</small>}{r.checked_out&&<small>Exit: {philippineTime(r.checked_out)}</small>}</td><td role="cell" data-label="Status"><span className={'visitor-status state-'+String(r.visit_status||r.status).toLowerCase()}>{visitLabel(r)}</span>{r.reason&&<small>{r.reason}</small>}</td><td role="cell" data-label="Actions"><div className="visitor-actions">
      {staff&&canReview&&r.status==='PENDING'&&<button className="admin-primary" onClick={()=>open(r,'review')}>Review request</button>}
      {r.visit_status==='EXPECTED'&&!r.voided&&<button className="admin-secondary" onClick={()=>open(r,'pass')}>Visitor pass</button>}
      {staff&&['EXPECTED','CHECKED_IN'].includes(r.visit_status||'')&&!r.voided&&<button className="admin-primary" onClick={()=>open(r,'verify')}>{r.visit_status==='EXPECTED'?'Verify entry':'Check out'}</button>}
      {canReview&&['PENDING','EXPECTED'].includes(r.visit_status||r.status)&&<button className="admin-secondary" disabled={busy} onClick={()=>open(r,'cancel')}>Cancel visit</button>}
      {staff&&r.visit_id&&<><button className="admin-secondary" onClick={()=>void run(async()=>{setHistory(await api<History[]>('/logbook/properties/'+property+'/visits/'+r.visit_id+'/history'));open(r,'history')})}>History</button><button className="admin-secondary" disabled={!canReview} onClick={()=>open(r,'amend')}>Record correction</button></>}
    </div></td></tr>)}</tbody></table></div>}

  </div>
  {dialog==='cancel'&&selected&&<ResidentDialog title="Cancel this visit?" busy={busy} onClose={close} dismissOnBackdrop={false} footerNote="">
    <p>{selected.full_name}?s visit will be cancelled and any issued pass will stop working.</p>
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    <div className="visitor-actions"><button className="admin-secondary" onClick={close} disabled={busy}>Keep visit</button>
    <button className="admin-primary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/requests/'+selected.id+'/cancel',{});close();setNotice('Visit cancelled. Any issued pass is revoked.')})}>Confirm cancellation</button></div>
  </ResidentDialog>}
  {dialog==='scan'&&<Suspense fallback={<p role="status">Loading scanner…</p>}><VisitorScanner onClose={close} onSearch={()=>{close();requestAnimationFrame(()=>searchInput.current?.focus())}} onScan={scan} scanError={error} busy={busy}/></Suspense>}
  {(dialog==='request'||dialog==='walkin')&&<ResidentDialog busy={busy} title={dialog==='walkin'?'Register a walk-in':'Register a visitor'} eyebrow="A THOUGHTFUL WELCOME" onClose={close} footerNote={footer}><VisitorForm hosts={hosts} walkin={dialog==='walkin'} busy={busy} error={error} onSubmit={data=>run(async()=>{if(dialog==='walkin'){const result=await api<{visitId:string}>('/logbook/walk-ins',data);await refresh();const all=await loadVisitorRecords(property);const r=all?.find(r=>r.visit_id===result.visitId);if(r){setSelected(r);setDialog('verify')}setNotice('Walk-in authorized. Verify identity and explicitly confirm entry.')}else{await api('/logbook/requests',data);close();setNotice('Visitor request submitted. Await staff approval; no entry has been recorded.');if(register)window.location.hash='/resident/logbook'}})}/></ResidentDialog>}
  {dialog==='review'&&selected&&<ResidentDialog busy={busy} title="Review visitor request" eyebrow="APPROVAL IS NOT CHECK-IN" onClose={close} footerNote={footer}><Summary record={selected}/><form className="visitor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{await api('/logbook/requests/'+selected.id+'/review',{action:f.get('action'),reason:f.get('reason')});close();setNotice('Visitor request reviewed. Approved visitors remain expected until staff confirm arrival.')})}}><label>Decision<select name="action" value={decision} onChange={event=>setDecision(event.target.value==='DECLINE'?'DECLINE':'APPROVE')}><option value="APPROVE">Approve visit</option><option value="DECLINE">Decline request</option></select></label><label>Reason (required when declining)<textarea name="reason" required={decision==='DECLINE'} maxLength={1000}/></label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>{decision==='APPROVE'?'Approve visit':'Decline visit'}</button></form></ResidentDialog>}
  {dialog==='pass'&&selected&&<ResidentDialog busy={busy} title="Visitor QR pass" eyebrow="SHARE WITH YOUR GUEST" onClose={close} footerNote="The pass contains a random code only. It is not an entry authorization on its own; staff verify identity. No email is sent."><Summary record={selected}/>{pass?<div className="visitor-pass">{qr&&<img src={qr} alt="Haruhay visitor QR pass"/>}<p>Valid until {philippineTime(pass.expiresAt)}</p><code>{pass.token}</code><div className="visitor-actions"><a className="admin-primary" href={qr} download="haruhay-visitor-pass.png">Download QR</a><button className="admin-secondary" onClick={()=>void run(async()=>{if(navigator.share)await navigator.share({title:'Haruhay visitor pass',text:pass.token});else{await navigator.clipboard.writeText(pass.token);setNotice('Pass code copied. Share it privately with your visitor.')}})}>Share pass code</button></div></div>:<div className="visitor-form"><p className="visitor-callout">Pass codes are displayed once. If one was issued before, select replacement to invalidate all previous copies.</p><label className="visitor-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Replace any previous pass. Old copies will stop working.</label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy} onClick={()=>void issue()}>{replace?'Replace visitor pass':'Generate visitor pass'}</button></div>}</ResidentDialog>}
  {dialog==='verify'&&selected&&<ResidentDialog busy={busy} title={selected.visit_status==='CHECKED_IN'?'Confirm visitor departure':'Verify visitor arrival'} eyebrow={scanToken?'QR VALIDATED · NO MOVEMENT RECORDED':'CONTROLLED RECORD SEARCH'} onClose={close} footerNote={footer}><Summary record={selected}/><form className="visitor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{const result=await api<Outcome>('/logbook/properties/'+property+'/visits/'+selected.visit_id+'/movement',{action:selected.visit_status==='CHECKED_IN'?'EXIT':'ENTRY',method:scanToken?'QR':'MANUAL',token:scanToken||null,identityConfirmed:f.get('identity')==='on',idType:f.get('idType')||null,idLastFour:f.get('idLastFour')||null,reason:f.get('reason')||null});if(!result.allowed)throw new Error(result.message);close();setNotice(result.message||'Movement saved.')})}}>{selected.visit_status!=='CHECKED_IN'&&<><label>ID type<input name="idType" required maxLength={80} placeholder="e.g. Driver’s license"/></label><label>Last four ID characters (optional)<input name="idLastFour" maxLength={4} pattern="[A-Za-z0-9]{4}" autoComplete="off"/></label><label className="visitor-check"><input type="checkbox" name="identity" required/>I checked the visitor’s presented identity against this record.</label></>}{!scanToken&&<label>Manual verification reason<textarea name="reason" required maxLength={1000} placeholder="Explain how the visit was identified and verified."/></label>}{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Confirm {selected.visit_status==='CHECKED_IN'?'check-out':'check-in'}</button></form></ResidentDialog>}
  {dialog==='amend'&&selected&&<ResidentDialog busy={busy} title="Record an audited change" eyebrow="HISTORY IS RETAINED" onClose={close} footerNote={footer}><Summary record={selected}/><form className="visitor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{await api('/logbook/properties/'+property+'/visits/'+selected.visit_id+'/amend',{action:f.get('action'),reason:f.get('reason')});close();setNotice('Change recorded in visit history.')})}}><label>Action<select name="action"><option value="CORRECTION">Append correction note</option><option value="REVOKE">Revoke pass (open checkout remains available)</option><option value="VOID">Void record (retain entry and exit evidence)</option></select></label><label>Reason<textarea name="reason" required maxLength={1000}/></label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Record change</button></form></ResidentDialog>}
  {(dialog==='activity'||dialog==='history'&&selected)&&<ResidentDialog busy={busy} title={dialog==='activity'?'Recent property activity':'Visit activity history'} eyebrow={dialog==='activity'?'LATEST 250 AUDIT EVENTS':selected!.full_name} onClose={close} footerNote={footer}>{history.map((h,i)=><article className="visitor-card" key={i}><strong>{h.event.replaceAll('_',' ')}</strong><p>{h.actor} · {philippineTime(h.occurred_at)}</p>{h.reason&&<p className="visitor-note">{h.reason}</p>}</article>)}</ResidentDialog>}
  {dialog==='guards'&&<ResidentDialog busy={busy} title="Property guards" eyebrow="NARROW LOGBOOK ACCESS" onClose={close} footerNote="Dedicated guard accounts access only the assigned property’s logbook. Credentials must be shared privately; this form sends no email."><div className="visitor-form">{guards.map(g=><article className="visitor-card" key={g.id}><strong>{g.full_name}</strong><p>{g.email}</p><div className="visitor-actions"><button className="admin-secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/properties/'+property+'/guards/'+g.id,{enabled:!g.enabled,canReview:g.can_review});setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'))})}>{g.enabled?'Disable':'Enable'}</button><button className="admin-secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/logbook/properties/'+property+'/guards/'+g.id,{enabled:g.enabled,canReview:!g.can_review});setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'))})}>{g.can_review?'Remove review permission':'Allow request review'}</button></div></article>)}<form className="visitor-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);void run(async()=>{await api('/logbook/properties/'+property+'/guards',{fullName:f.get('fullName'),email:f.get('email'),password:f.get('password'),canReview:f.get('canReview')==='on'});form.reset();setGuards(await api<Guard[]>('/logbook/properties/'+property+'/guards'));setNotice('Guard account created. No email was sent.')})}}><h2>Add a guard</h2><label>Full name<input name="fullName" required maxLength={100}/></label><label>Dedicated staff email<input type="email" name="email" required maxLength={254}/></label><label>Initial password<input type="password" name="password" required minLength={12} maxLength={72} autoComplete="new-password"/></label><label className="visitor-check"><input name="canReview" type="checkbox"/>Can approve or decline visitor requests and authorize walk-ins</label>{error&&<p role="alert">{error}</p>}<button className="admin-primary" disabled={busy}>Create guard account</button></form></div></ResidentDialog>}
  </Frame>
}
function Summary({record:r}:{record:VisitorRecord}){return <dl className="visitor-summary"><div><dt>Visitor</dt><dd>{r.full_name}</dd></div><div><dt>Host / room</dt><dd>{r.host_name} / {r.room_label}</dd></div><div><dt>Arrival (PHT)</dt><dd>{philippineTime(r.arrival)}</dd></div><div><dt>Departure (PHT)</dt><dd>{philippineTime(r.departure)}</dd></div><div><dt>Purpose</dt><dd>{r.purpose}</dd></div><div><dt>Current state</dt><dd>{visitLabel(r)}</dd></div></dl>}
function VisitorForm({hosts,walkin,busy,error,onSubmit}:{hosts:Host[];walkin:boolean;busy:boolean;error:string;onSubmit:(data:object)=>Promise<void>}){
  const [tenancyId,setTenancyId]=useState('')
  const feedback=useFormFeedback()
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form=event.currentTarget
    const fields=new FormData(form)
    const arrival=String(fields.get('arrival')||'')
    const departure=String(fields.get('departure')||'')
    if(!feedback.validate(form,arrival&&departure&&departure<=arrival
      ? [{name:'departure',label:'Expected departure',message:'Choose a time after expected arrival.'}] : [])) return

    const visitor={
      tenancyId:fields.get('tenancyId'),fullName:fields.get('fullName'),contact:fields.get('contact'),
      purpose:fields.get('purpose'),arrival:localInput(arrival),departure:localInput(departure),
    }
    void onSubmit(walkin?{visitor,hostAuthorized:fields.get('hostAuthorized')==='on',reason:fields.get('reason')}:visitor)
  }
  return <form className="visitor-form" noValidate onSubmit={submit} onChange={e=>{
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement) feedback.clear(e.target.name)
  }}>
    <p className="visitor-muted">Use the guest’s name as shown on their ID. Enter times in Philippine time.</p>
    {feedback.summary}
    {error&&<p className="ux-status" data-tone="error" role="alert">{error}</p>}
    <div className="visitor-form-grid">
      <label>Full name<input name="fullName" required maxLength={100} {...feedback.fieldProps('fullName')}/>{feedback.fieldError('fullName')}</label>
      <label>Contact number<input name="contact" type="tel" required maxLength={100} {...feedback.fieldProps('contact')}/>{feedback.fieldError('contact')}</label>
      <label>Purpose<input name="purpose" required maxLength={500} {...feedback.fieldProps('purpose')}/>{feedback.fieldError('purpose')}</label>
      <label>Host / room<select name="tenancyId" required value={tenancyId||(hosts.length===1?hosts[0].id:'')} onChange={e=>setTenancyId(e.target.value)} {...feedback.fieldProps('tenancyId')}><option value="" disabled>Select active host</option>{hosts.map(h=><option value={h.id} key={h.id}>{h.full_name} · {h.property_name} / {h.label}</option>)}</select>{feedback.fieldError('tenancyId')}</label>
      <label>Expected arrival<input name="arrival" type="datetime-local" required {...feedback.fieldProps('arrival')}/>{feedback.fieldError('arrival')}</label>
      <label>Expected departure<input name="departure" type="datetime-local" required {...feedback.fieldProps('departure')}/>{feedback.fieldError('departure')}</label>
    </div>
    {!hosts.length&&<p role="alert">No active hosts available. An active tenancy is required.</p>}
    {walkin&&<>
      <label className="visitor-check"><input type="checkbox" required name="hostAuthorized" {...feedback.fieldProps('hostAuthorized')}/>I confirmed this visit with the active host.</label>{feedback.fieldError('hostAuthorized')}
      <label>Host authorization details<textarea name="reason" required maxLength={1000} {...feedback.fieldProps('reason')}/>{feedback.fieldError('reason')}</label>
    </>}
    <p className="visitor-callout">{walkin?'Next, check the visitor’s ID and confirm check-in.':'Staff review your request before a pass is available. Ask your guest to bring valid ID.'}</p>
    <button className="admin-primary" disabled={busy||!hosts.length}>{busy?'Saving…':walkin?'Authorize walk-in':'Submit visitor request'}</button>
  </form>
}
