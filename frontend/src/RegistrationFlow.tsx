import { RoomPicker, RoomManager, Terms } from './RoomFlow'
import type { RoomTerms } from './RoomFlow'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AuthField, WelcomePanel } from './AuthShared'
import { AdminHeading, AdminIcon, AdminMetrics, AdminStatus, AdminTable } from './AdminUI'
import { api, ApiError, deliveryText } from './registrationApi'
import type { Account, Admission, Delivery, Property, Room } from './registrationApi'
import artwork from './auth-artwork.json'
import './RegistrationFlow.css'
import './Onboarding.css'
import AdminLayout from './AdminLayout'
import ResidentLayout from './ResidentLayout'
import ResidentDialog from './ResidentDialog'
import { useFormFeedback } from './FormFeedback'
import { loadWorkspaceSession, clearWorkspaceSession, hasActiveStay, hasEndedStay, hasPendingApplication } from './workspaceSession'

const node = '18:1809'
const label = (status: string) => ({ AWAITING_EMAIL: 'Verify email', PENDING_APPROVAL: 'Pending owner approval', APPROVED: 'Active tenancy', CORRECTIONS_REQUESTED: 'Corrections requested', REJECTED: 'Rejected', CANCELLED: 'Cancelled' }[status] || status)
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to save. Please try again.'
const approvalDelivery = (result: Delivery) => result.delivery === 'LOCAL_FILE'
  ? 'Local delivery mode: no welcome email was sent.'
  : result.delivery === 'FAILED' ? 'Approval is saved and the tenancy is active, but the notification email could not be sent.' : result.delivery === 'SMTP_ACCEPTED' ? 'The email server accepted the approval notification for the resident’s email address.' : ''
type Tools = { busy: boolean; run: (action: () => Promise<void>) => Promise<void>; notice: (value: string) => void; refresh: () => void }
type Review = { app: Admission; action: 'offer' | 'approve' | 'corrections' | 'reject' | 'release' }

function Dialog({ title, children, close, error, busy }: { title: string; children: ReactNode; close: () => void; error: string; busy: boolean }) {
  return <ResidentDialog title={title} onClose={close} dismissOnBackdrop={false} footerNote="" busy={busy}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {children}
  </ResidentDialog>
}

function Workspace({ account, children, message, dismiss }: { account: Account; children: ReactNode; message:string; dismiss:()=>void }) {
  const [notice, setNotice] = useState('')
  return account.role === 'OWNER'
    ? <AdminLayout notice={message} onDismissNotice={dismiss} active={window.location.hash.includes('/property') ? 'Property & rooms' : 'Applications'} node={node}>{children}</AdminLayout>
    : <ResidentLayout activeSection="Application status" breadcrumb="Application status" notice={notice} onNotice={setNotice} onDismissNotice={() => setNotice('')}>{children}</ResidentLayout>
}

export default function RegistrationFlow() {
  const route = window.location.hash.split('?')[0]
  const params = new URLSearchParams(window.location.hash.split('?')[1])
  const token = params.get('token') || ''
  const signup = route === '#/register' || route === '#/account/register'
  const verify = route === '#/account/verify'
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [propertyChoice,setPropertyChoice] = useState('')
  const [chosenRoom,setChosenRoom] = useState<RoomTerms|null>(null)
  const chooseRoom=useCallback((room:RoomTerms|null)=>setChosenRoom(room),[])
  const [properties, setProperties] = useState<Property[]>([])
  const [propertyLoad, setPropertyLoad] = useState<'loading'|'ready'|'error'>('loading')
  const [propertyRetry, setPropertyRetry] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => route === '#/login' && params.get('password-reset') === 'complete'
    ? 'Password updated. Sign in with your new password.' : '')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [verified, setVerified] = useState(false)
  const [version, setVersion] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const feedback = useFormFeedback()
  useEffect(() => {
    let active = true
    document.title = (signup ? 'Create your account' : 'Welcome home') + ' | Haruhay'
    api<Account>('/account').then(async a => { await loadWorkspaceSession(a); if (active) setAccount(a) }).catch(e => {
      if (active && !(e instanceof ApiError && e.status === 401)) setError(errorText(e))
    }).finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [signup])
  useEffect(() => {
    if (!signup) return
    let active = true
    api<Property[]>('/public/properties').then(list => {
      if (active) { setProperties(list); setPropertyLoad('ready') }
    }).catch(() => { if (active) setPropertyLoad('error') })
    return () => { active = false }
  }, [signup, propertyRetry])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  function refresh() {
    setVersion(v => v + 1)
    loadWorkspaceSession().then(s=>setAccount(s.account)).catch(e => { if (e instanceof ApiError && e.status === 401) setAccount(null); else setError(errorText(e)) })
  }
  const tools: Tools = { run, busy, notice: setNotice, refresh }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; if (!feedback.validate(form)) return; const d = new FormData(form)
    await run(async () => {
      if (signup) {
        const result = await api<Delivery>('/public/accounts/signup', { email: String(d.get('email')), fullName: String(d.get('fullName')), contact: String(d.get('contact')), password: account ? undefined : String(d.get('password')), propertyId: String(d.get('propertyId')), roomId: chosenRoom?.id, roomVersion: chosenRoom?.terms_version, acceptedTerms:d.has('acceptedTerms') })
        setNotice(deliveryText(result)); setSubmitted(true); form.reset()
      } else {
        await api('/auth/login', new URLSearchParams({ username: String(d.get('email')), password: String(d.get('password')) }))
        const identity = await api<Account>('/account'); const workspace = await loadWorkspaceSession(identity); setAccount(identity); window.location.hash = identity.role === 'GUARD' ? '/guard/logbook' : identity.role === 'TECHNICIAN' ? '/technician/jobs' : identity.role === 'OWNER' ? '/admin/dashboard' : hasActiveStay(workspace.applications) ? '/resident/dashboard' : hasEndedStay(workspace.applications) && !hasPendingApplication(workspace.applications) ? '/resident/payments' : '/account/status'
      }
    })
  }
  if (loading) return <main className="onboarding-loading" role="status">Opening your Haruhay account…</main>
  if (!account || signup || verify) return <main className={'auth-shell live-auth'+(signup?' live-signup':'')} data-design-node={signup ? '18:158' : '18:106'}>
    <WelcomePanel screen={signup ? 'register' : 'login'} />
    <section className={'form-panel ' + (signup ? 'register onboarding-signup' : 'login')} aria-labelledby="live-auth-title"><div className="auth-content">
      <header className="auth-header"><span className="badge">{verify ? 'APPLICATION EMAIL' : signup ? 'JOIN OUR COMMUNITY' : 'WELCOME HOME'}</span><h1 ref={heading} id="live-auth-title" tabIndex={-1}>{verify ? 'Verify your email' : signup ? 'Create your account' : 'Welcome back'}</h1><p>{verify ? 'One small step before your property owner reviews your application.' : signup ? 'Choose a room and review its terms before you send your application.' : 'Sign in to manage your stay and stay in touch.'}</p></header>
      {signup && account && <div className="form-notice"><p>You are signed in as <strong>{account.email}</strong>. Apply with this account, or sign out to register someone else.</p><button className="admin-secondary" type="button" disabled={busy} onClick={() => run(async () => { await api('/auth/logout', {}); clearWorkspaceSession(); setAccount(null); setSubmitted(false); setNotice('You can now create a new account with a different email address.'); })}>Create account with another email</button></div>}
      {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-notice">{notice}</p>}
      {verify ? <div className="onboarding-auth-status">{verified ? <><h2>Email verified</h2><p>Your application is now pending owner approval. Owner approval will automatically activate your tenancy.</p></> : token ? <button className="primary-button" disabled={busy} onClick={() => run(async () => { await api('/public/email/verify', { token }); setVerified(true); setNotice('Your email has been verified.') })}>Verify my email</button> : <p>The verification link is missing. Sign in to request a new one.</p>}<a href="#/account/status">Continue to my account</a></div>
        : submitted ? <div className="onboarding-auth-status"><h2>Your application is on its way</h2><p>Verify your email, then sign in to follow your application. Your owner will review the room assignment and approval.</p><a className="admin-primary" href="#/login">Continue to sign in</a></div>
          : <form key={account?.id || 'new-account'} className="auth-form" noValidate onChange={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) feedback.clear(e.target.name) }} onSubmit={submit} aria-label={signup ? 'Create your account' : 'Sign in to your account'}>
            {feedback.summary}
            {signup && <div className="ux-form-header"><h2>Choose a property and room</h2><p>See availability, fees and house rules before you apply.</p></div>}
            {signup && <div className="form-field"><label htmlFor="live-property">Dormitory / property</label><div className="input-wrap"><img className="field-icon" src={artwork.register.IconBuilding} alt="" /><select id="live-property" name="propertyId" {...feedback.fieldProps('propertyId')} required disabled={propertyLoad !== 'ready'} defaultValue="" onChange={e=>{setPropertyChoice(e.target.value);setChosenRoom(null)}}><option value="" disabled>Choose your boarding house</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>{feedback.fieldError('propertyId')}{propertyLoad === 'loading' && <p role="status" className="onboarding-hint">Loading properties...</p>}
              {propertyLoad === 'error' && <p className="ux-status" data-tone="error" role="alert">Properties could not be loaded. <button className="admin-secondary" type="button" onClick={() => { setPropertyLoad('loading'); setPropertyRetry(n => n + 1) }}>Try again</button></p>}
              {propertyLoad === 'ready' && !properties.length && <p className="onboarding-hint">No properties are accepting applications yet. Check back later or contact the property owner.</p>}</div>}
            {signup && propertyChoice && <RoomPicker key={propertyChoice} property={propertyChoice} onChoose={chooseRoom}/>}
            {signup && chosenRoom && <section className="room-review-summary"><h3>Your application summary</h3><p>{chosenRoom.property_name} / {chosenRoom.label}</p><details><summary>Review costs, inclusions and rules</summary><Terms room={chosenRoom}/></details><label className="room-check"><input type="checkbox" name="acceptedTerms" {...feedback.fieldProps('acceptedTerms')} required key={chosenRoom.id+chosenRoom.terms_version}/>I agree to the room details and pricing shown above.</label>{feedback.fieldError('acceptedTerms')}</section>}
            {signup && <div className="ux-form-header"><h2>Your details</h2><p>Use an email you can access to verify your account.</p></div>}
            {signup && <><AuthField id="live-full-name" name="fullName" {...feedback.fieldProps('fullName')} error={feedback.fieldError('fullName')} label="Full name" icon={artwork.register.IconUser} placeholder="Your full name" defaultValue={account?.full_name} autoComplete="name" maxLength={100} /><AuthField id="live-contact" name="contact" {...feedback.fieldProps('contact')} error={feedback.fieldError('contact')} label="Contact number" icon={artwork.register.IconUser} placeholder="Your contact number" defaultValue={account?.contact} type="tel" autoComplete="tel" maxLength={100} /></>}
            <AuthField id="live-email" name="email" {...feedback.fieldProps('email')} error={feedback.fieldError('email')} label="Email address" icon={artwork.login.IconMail} placeholder="you@example.com" type="email" autoComplete="email" defaultValue={account?.email} readOnly={Boolean(account)} maxLength={254} />
            {!(signup && account) && <AuthField id="live-password" name="password" {...feedback.fieldProps('password')} error={feedback.fieldError('password')} label={signup ? 'Password (at least 12 characters)' : 'Password'} icon={artwork.login.IconLock} type="password" placeholder={signup ? 'Create a secure password' : 'Enter your password'} autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 12 : undefined} maxLength={72} />}
            {!signup && <a className="forgot-link" href="#/forgot-password">Forgot password?</a>}
            <button className="primary-button" disabled={busy || (signup && (properties.length === 0 || !chosenRoom))}>{busy ? 'Please wait…' : signup ? account ? 'Submit my application' : 'Create an account' : 'Sign in to Haruhay'}</button>
          </form>}
      {!verify && <nav className="auth-nav" aria-label="Account">{signup ? <a href="#/login">Already registered? <strong>Log in</strong></a> : <a href="#/register">New here? <strong>Create an account</strong></a>}</nav>}
      <footer className="auth-footer"><p><img src={artwork.login.IconShield1} alt="" />Safe, private and made for your community.</p><p><a href="#/preview/login">Explore the separate sample UI previews</a></p></footer>
    </div></section>
  </main>
  return <Workspace account={account} message={notice} dismiss={()=>setNotice('')}><div className="onboarding-content">
    {error && <p role="alert" className="form-error">{error}</p>}{notice && account.role!=='OWNER' && <p role="status" className="form-notice">{notice}</p>}
    {account.role === 'OWNER' ? <Owner key={route} revision={version} {...tools} error={error} setup={route === '#/account/property' || route === '#/admin/property'} /> : <Applicant key={version} {...tools} account={account} error={error} />}
  </div></Workspace>
}

function Owner({ run, busy, notice, refresh, error, setup, revision }: Tools & { error: string; setup: boolean; revision: number }) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [apps, setApps] = useState<Admission[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [proposal,setProposal]=useState<RoomTerms|null>(null)
  const [review, setReview] = useState<Review | null>(null)
  useEffect(() => {
    let active = true
    Promise.all([api<Room[]>('/owner/rooms'), api<Property[]>('/owner/properties'), api<Admission[]>('/owner/admissions')]).then(([r, p, a]) => { if (active) { setRooms(r); setProperties(p); setApps(a); setLoadError('') } }).catch(e => { if (active) setLoadError(errorText(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  if (loading) return <p className="ux-status" role="status">Loading your property records…</p>
  if (loadError) return <p className="form-error" role="alert">{loadError} <button className="admin-secondary" onClick={refresh}>Retry</button></p>
  if (setup) return <>
    <AdminHeading eyebrow="YOUR PROPERTY" title="Property & rooms" description="Start with your own property and room capacity. No sample records are added." />
    <div className="onboarding-setup-grid"><section className="admin-panel"><h2>Add a property</h2><form className="registration-form" onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); run(async () => { await api('/owner/properties', { name }); notice('Property added. You can now add rooms.'); refresh() }) }}><label>Property name<input name="name" required maxLength={160} placeholder="Your property name" /></label><button className="admin-primary" disabled={busy}>Add property</button></form></section>
      <section className="admin-panel"><h2>Add a room</h2>{!properties.length ? <p>Add your property first, then enter its rooms.</p> : <form className="registration-form" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); run(async () => { await api('/owner/rooms', { propertyId: String(d.get('propertyId')), label: String(d.get('label')), capacity: Number(d.get('capacity')) }); notice('Room added with its available occupancy places.'); refresh() }) }}><label>Property<select name="propertyId" required>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Room name / number<input name="label" required maxLength={80} placeholder="Room name or number" /></label><label>Occupant capacity<input name="capacity" type="number" min={1} max={100} required placeholder="1 for a private room" /></label><button className="admin-primary" disabled={busy}>Add room</button></form>}</section></div>
    <RoomManager rooms={rooms as unknown as RoomTerms[]} onSaved={refresh}/><section className="onboarding-section"><h2>Your rooms</h2><AdminTable columns={['Property', 'Room', 'Capacity', 'Held', 'Active']} empty="No rooms yet. Add your first room above." rows={rooms.map(r => ({ key: r.id, cells: [r.property_name, r.label, r.capacity, r.held, r.active] }))} /></section>
  </>
  const pending = apps.filter(a => a.status === 'PENDING_APPROVAL')
  const shown = apps.filter(a => (!filter || (filter === 'APPROVED' ? a.tenancy_status === 'ACTIVE' : a.status === filter)) && (a.full_name + ' ' + a.email + ' ' + a.property_name).toLowerCase().includes(query.toLowerCase().trim()))
  return <>
    <AdminHeading eyebrow="COMMUNITY DIRECTORY" title="Resident applications" description="Review each application and confirm the accepted room and terms. Approval opens the resident portal." action={<button className="admin-secondary" onClick={refresh}>Refresh records</button>} />
    <AdminMetrics node={node} items={[{ label: 'Awaiting owner approval', value: pending.length, icon: 'imgIconUsers1' }, { label: 'Awaiting email verification', value: apps.filter(a => a.status === 'AWAITING_EMAIL').length, icon: 'imgIconClock' }, { label: 'Held places', value: rooms.reduce((n, r) => n + r.held, 0), icon: 'imgIconBuilding' }, { label: 'Active tenancies', value: rooms.reduce((n, r) => n + r.active, 0), icon: 'imgIconCheck', tone: 'mint' }]} />
    {!properties.length && <section className="admin-panel onboarding-section"><h2>Welcome to your empty workspace</h2><p>Add your property and rooms before residents apply. Your account has no sample residents or activity.</p><a className="admin-primary" href="#/account/property">Set up my property</a></section>}
    <ul className="ux-queue-links" aria-label="Application queues">{[
      { value: '', label: 'All', count: apps.length },
      { value: 'PENDING_APPROVAL', label: 'Needs review', count: pending.length },
      { value: 'AWAITING_EMAIL', label: 'Awaiting email', count: apps.filter(a => a.status === 'AWAITING_EMAIL').length },
      { value: 'APPROVED', label: 'Active', count: apps.filter(a => a.tenancy_status === 'ACTIVE').length },
    ].map(queue => <li key={queue.value}><button type="button" aria-pressed={filter === queue.value} onClick={() => setFilter(queue.value)}>{queue.label} <strong>{queue.count}</strong></button></li>)}</ul>
    <div className="onboarding-toolbar"><label className="admin-search"><AdminIcon node={node} name="imgIconSearch1" /><input aria-label="Search applications" type="search" placeholder="Search by name, email or property…" value={query} onChange={e => setQuery(e.target.value)} /></label><label>Show<select aria-label="Filter applications" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All applications</option>{['PENDING_APPROVAL', 'AWAITING_EMAIL', 'CORRECTIONS_REQUESTED', 'REJECTED', 'APPROVED', 'CANCELLED'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label></div>
    <p className="ux-results-count" role="status">{shown.length} of {apps.length} applications {(query || filter) && <button type="button" className="admin-link-button" onClick={() => { setQuery(''); setFilter('') }}>Clear filters</button>}</p>
    <AdminTable columns={['Applicant', 'Property / room', 'Status', 'Actions']} empty={apps.length ? 'No applications match your search.' : 'No applications yet. Residents can apply through Create an account.'} rows={shown.map(a => ({ key: a.id, cells: [<div><strong>{a.full_name}</strong><small>{a.email}</small><small>{a.contact}</small></div>, <div>{a.property_name}<small>{a.room_label || a.offers?.[0]?.terms.label || 'Room terms not selected'}</small></div>, <div><AdminStatus>{label(a.status)}</AdminStatus>{a.reservation_status === 'HELD' && <small className="onboarding-held">Reservation still held</small>}{a.review_reason && <small>{a.review_reason}</small>}</div>, <div className="onboarding-row-actions">
      {a.status === 'PENDING_APPROVAL' && <button className="admin-primary" disabled={busy} onClick={() => setReview({ app: a, action: 'approve' })}>Review & approve</button>}
      {['PENDING_APPROVAL','CORRECTIONS_REQUESTED'].includes(a.status) && <button className="admin-secondary" onClick={()=>setReview({app:a,action:'offer'})}>Propose room / revised terms</button>}{['PENDING_APPROVAL'].includes(a.status) && <><button className="admin-secondary" disabled={busy} onClick={() => setReview({ app: a, action: 'corrections' })}>Request corrections</button><button className="admin-secondary" disabled={busy} onClick={() => setReview({ app: a, action: 'reject' })}>Reject</button></>}
      {a.reservation_status === 'HELD' && <button className="admin-secondary" disabled={busy} onClick={() => setReview({ app: a, action: 'release' })}>Cancel & release place</button>}
    </div>] }))} />
    {review && <Dialog busy={busy} title={review.action === 'offer' ? 'Propose revised room terms' : review.action === 'approve' ? 'Approve room assignment' : review.action === 'release' ? 'Cancel and release reserved place' : review.action === 'reject' ? 'Reject application' : 'Request corrections'} error={error} close={() => setReview(null)}>
      <p>{review.app.full_name} · {review.app.email}</p><p>{review.action === 'approve' ? 'Confirm the selected room and accepted agreement. Approval starts their tenancy and opens resident services.' : review.action === 'release' ? 'This explicitly frees the held place and cancels the application.' : 'Any existing reservation stays held until you explicitly release it.'}</p>
      <form className="registration-form" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); run(async () => { const result = await api<Delivery & { message: string }>('/owner/admissions/' + review.app.id + '/' + review.action, { reason: String(d.get('reason')), ...(review.action === 'offer' ? {roomId:String(d.get('roomId')),roomVersion:Number(d.get('roomVersion')),quote:d.get('quote')===''?null:Number(d.get('quote'))} : {}), ...(review.action === 'approve' ? { roomId: String(d.get('roomId')) } : {}) }); setReview(null); notice((review.action==='approve'?review.app.full_name+' approved. '+(review.app.offers?.[0]?.terms.label||'The room')+' tenancy is active.':result.message) + (result.delivery ? ' ' + (review.action==='approve'?approvalDelivery(result):result.delivery==='FAILED'?'Update saved, but notification email delivery failed.':result.delivery==='LOCAL_FILE'?'No email sent: the update is in the local development mail folder.':'The mail server accepted the update notification.') : '')); refresh() }) }}>
        {review.app.offers?.[0] && (rooms as unknown as RoomTerms[]).find(r=>r.id===review.app.offers?.[0].room_id)?.terms_version!==review.app.offers?.[0]?.room_version && <p className="room-note">The listing has changed since this offer. Send a revised offer and obtain acceptance before approval.</p>}{review.app.offers?.[0] && <details className="room-agreement"><summary>Accepted room terms / Offer {review.app.offers[0].version} / {review.app.offers[0].accepted_at?'Accepted':'Awaiting acceptance'}</summary><Terms compact room={review.app.offers[0].terms}/></details>}
        {review.action === 'offer' && <><label>Room<select name="roomId" required onChange={e=>{const input=e.currentTarget.form?.elements.namedItem('roomVersion') as HTMLInputElement;const room=(rooms as unknown as RoomTerms[]).find(r=>r.id===e.target.value);setProposal(room||null);if(input)input.value=String(room?.terms_version)}} defaultValue=""><option value="" disabled>Choose proposed room</option>{(rooms as unknown as RoomTerms[]).filter(r=>r.property_id===review.app.property_id).map(r=><option value={r.id} key={r.id}>{r.label} / Listing version {r.terms_version}</option>)}</select></label><input name="roomVersion" type="hidden"/>{proposal&&<Terms room={proposal}/>}<label>Applicant monthly quote (PHP; leave blank to use listing)<input name="quote" type="number" min="0" step="0.01"/></label><p>Changes require the applicant to accept the exact new offer before final approval. No place is reserved.</p></>}
        {review.action === 'approve' && <><input type="hidden" name="roomId" value={review.app.offers?.[0]?.room_id||''}/><section className="approval-room"><span>CONFIRMED ROOM</span><strong>{review.app.offers?.[0]?.terms.label||'No room selected'}</strong>{review.app.offers?.[0] && <p>Monthly rent: {(review.app.offers[0].terms.applicant_monthly_rent == null ? 'To be confirmed' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(review.app.offers[0].terms.applicant_monthly_rent))}</p>}<p>Approval uses only the latest room and terms accepted by the applicant. To change them, send a revised offer first.</p>{!review.app.offers?.[0]?.accepted_at&&<p role="alert">The applicant must accept the latest offer before approval.</p>}</section></>}
        <label>Reason / review notes<textarea name="reason" required rows={4} maxLength={1000} /></label><button className="admin-primary" disabled={busy||(review.action==='approve'&&!review.app.offers?.[0]?.accepted_at)}>{review.action === 'approve' ? 'Approve & start tenancy' : review.action === 'release' ? 'Confirm cancel & release' : 'Save review'}</button>
      </form>
    </Dialog>}
  </>
}

function Applicant({ account, run, busy, notice, refresh, error }: Tools & { account: Account; error: string }) {
  const [apps, setApps] = useState<Admission[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<Admission | null>(null)
  useEffect(() => {
    let active = true
    let checking = false
    async function checkStatus() {
      if (checking) return
      checking = true
      try {
        const applications = await api<Admission[]>('/account/admissions')
        if (!active) return
        if (hasActiveStay(applications)) {
          await loadWorkspaceSession()
          if (active) window.location.replace('#/resident/dashboard')
          return
        }
        setApps(applications.filter(a => a.status !== 'APPROVED')); setLoadError('')
      } catch (e) { if (active) setLoadError(errorText(e)) }
      finally { checking = false }
    }
    const checkVisible = () => { if (document.visibilityState === 'visible') void checkStatus() }
    void checkStatus()
    const interval = window.setInterval(checkVisible, 15000)
    window.addEventListener('focus', checkVisible)
    document.addEventListener('visibilitychange', checkVisible)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', checkVisible); document.removeEventListener('visibilitychange', checkVisible) }
  }, [])
  const verified = account.email_verified || Boolean(apps?.some(a => a.email_verified))
  const resend = () => run(async () => {
    const result = await api<Delivery>('/account/verification', {})
    notice(deliveryText(result))
    refresh()
  })
  return <div className="application-page resident-content">
    <header className="application-heading resident-page-heading"><span>YOUR NEXT CHAPTER</span><h1>Application status</h1><p>Check what’s complete and whether you need to take action.</p></header>
    {loadError && <div className="application-error" role="alert"><p>{loadError}</p><button className="admin-secondary" onClick={refresh}>Try again</button></div>}
    {!apps && !loadError && <p role="status">Loading your application...</p>}
    <div className="application-columns"><div className="application-main">
      {apps?.length === 0 && <section className="application-card"><img className="application-status-icon" src="./assets/dashboard/icon-home.svg" alt="" /><h2>Your place is waiting</h2><p>Choose your property to submit an application using this account.</p><a className="admin-primary" href="#/register">Apply to a property</a></section>}
      {apps?.map(a => {
        const correction = a.status === 'CORRECTIONS_REQUESTED'
        const closed = ['REJECTED', 'CANCELLED'].includes(a.status)
        const currentStep = a.email_verified ? 2 : 1
        const title = a.status === 'AWAITING_EMAIL' ? 'Check your inbox' : correction ? 'A few details to update' : a.status === 'REJECTED' ? 'An update from your owner' : a.status === 'CANCELLED' ? 'Application closed' : 'Waiting for owner review'
        const description = a.status === 'AWAITING_EMAIL' ? 'Verify your email address so your property owner can review your application.' : correction ? 'Your owner needs a few corrections before continuing the review. Update your details below.' : a.status === 'REJECTED' ? 'Your owner could not approve this application. Please review their feedback below.' : a.status === 'CANCELLED' ? 'Your owner has cancelled this application. Any reserved place has been released.' : 'Your email is verified. Your property owner will review your details and confirm the room and terms you selected.'
        return <section className={'application-card application-status-card' + (closed || correction ? ' application-needs-attention' : '')} key={a.id} aria-label={label(a.status)}>
          <div className="application-card-top"><img className="application-status-icon" src={'./assets/dashboard/' + (correction || closed ? 'icon-book-nav.svg' : 'icon-shield.svg')} alt="" /><span className="application-status-pill">{label(a.status)}</span></div>
          <h2>{title}</h2><p>{description}</p>
          {a.status === 'AWAITING_EMAIL' && <div className="application-verify-action">
            <p>We sent a verification link when you created your account. Check your inbox and spam folder. If it has not arrived, request a new link.</p>
            <button className="admin-primary" disabled={busy} onClick={resend}>{busy ? 'Sending...' : 'Resend verification email'}</button>
          </div>}
          <ApplicantOffers app={a} run={run} refresh={refresh} busy={busy}/>
          <ol className="application-steps" aria-label="Application progress">{['Account created', 'Email verified', 'Owner approval'].map((step, i) => <li key={step} className={i < currentStep ? 'is-complete' : i === currentStep && !closed ? 'is-current' : ''} aria-current={!closed && i === currentStep ? 'step' : undefined}><span aria-hidden="true">{i < currentStep ? '\u2713' : i + 1}</span><strong>{step}</strong><small>{i < currentStep ? 'Complete' : closed ? 'Not completed' : correction ? 'Changes needed' : i === currentStep ? currentStep === 1 ? 'Action needed' : 'In review' : 'Up next'}</small></li>)}</ol>
          {a.review_reason && <div className="application-feedback"><h3>A note from your owner</h3><p>{a.review_reason}</p></div>}
          {a.reservation_status === 'HELD' && <p className="application-reservation">Your place is still reserved. Only your owner can release it.</p>}
          {correction && <button className="admin-primary" disabled={busy} onClick={() => setEditing(a)}>Edit and resubmit</button>}
          <div className="application-property"><img src="./assets/dashboard/icon-home.svg" width="24" height="24" alt="" /><div><small>YOUR PROPERTY</small><strong>{a.property_name}</strong><p>{a.room_label ? 'Assigned room: ' + a.room_label : a.offers?.[0] ? 'Selected room: '+a.offers[0].terms.label : 'Awaiting a room offer'}</p></div></div>
          {!closed && <div className="application-next"><h3>What happens next?</h3><p>{!a.email_verified ? 'Open the verification link in your signup email. You only need to verify once.' : correction ? 'Submit your corrected details to return your application to owner review.' : 'Once approved, your resident dashboard and all services become available automatically. No second verification is needed.'}</p>{!a.room_label && <small>No room is reserved until your owner approves your assignment.</small>}</div>}
        </section>
      })}
      <div className="application-refresh"><span><span className="application-live-dot" aria-hidden="true" />Status updates automatically</span><button className="admin-secondary" disabled={busy} onClick={refresh}>Refresh status</button></div>
    </div><aside className="application-side">
      <section className="application-card application-account"><h2>Your account</h2><span className={'application-email-state' + (verified ? ' is-verified' : '')}>{verified ? 'Email verified' : 'Verification needed'}</span><dl><dt>Full name</dt><dd>{account.full_name}</dd><dt>Email address</dt><dd>{account.email}</dd><dt>Contact number</dt><dd>{account.contact || 'Not provided'}</dd></dl>{!verified && !apps?.some(a => a.status === 'AWAITING_EMAIL') && <button className="admin-secondary" disabled={busy} onClick={resend}>Resend verification email</button>}</section>
      <section className="application-reassurance"><img src="./assets/dashboard/icon-heart-nav.svg" width="28" height="28" alt="" /><h2>A little closer to home.</h2><p>Your application details are private and shared with your property owner for review.</p></section>
    </aside></div>
    {editing && <Dialog busy={busy} title="Correct application details" close={() => setEditing(null)} error={error}><form className="registration-form" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); run(async () => { await api('/account/admissions/' + editing.id + '/corrections', { fullName: String(d.get('fullName')), contact: String(d.get('contact')) }); setEditing(null); notice('Corrections submitted for owner review.'); refresh() }) }}><label>Full name<input name="fullName" required maxLength={100} defaultValue={editing.full_name} /></label><label>Contact number<input name="contact" type="tel" required maxLength={100} defaultValue={editing.contact} /></label><button className="admin-primary" disabled={busy}>Submit corrections</button></form></Dialog>}
  </div>
}

function ApplicantOffers({app,run,refresh,busy}:{app:Admission;run:Tools['run'];refresh:()=>void;busy:boolean}){const offer=app.offers?.[0];return offer?<section className="room-agreement"><details><summary>{offer.accepted_at?'Your accepted room agreement':'Revised room offer: please review'} ? Version {offer.version}</summary><p>{offer.reason}</p>{app.offers?.[1]&&<OfferChanges previous={app.offers[1].terms} current={offer.terms}/>}{app.offers?.[1]&&<p className="room-note">Updated agreement: review room, rent, deposit, charges, inclusions and rules below against your previous offer. Acceptance applies only to version {offer.version}.</p>}<Terms room={offer.terms}/>{app.offers?.slice(1).map(previous=><details key={previous.id}><summary>Previous offer {previous.version} ({previous.accepted_at?'accepted':'superseded'})</summary><Terms room={previous.terms}/></details>)}</details>{!offer.accepted_at&&<form className="room-offer-actions" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/account/admissions/'+app.id+'/accept-offer',{offerId:offer.id});refresh()})}}><label className="room-check"><input type="checkbox" required/>I accept this exact room and pricing offer. Owner approval is still required.</label><button className="admin-primary" disabled={busy}>Accept revised offer</button></form>}</section>:<p>Your owner will send room terms for your acceptance before final approval.</p>}

function OfferChanges({previous,current}:{previous:RoomTerms;current:RoomTerms}){const fields: [keyof RoomTerms,string][]=[['label','Room'],['applicant_monthly_rent','Your monthly rent'],['monthly_rent','Advertised rent'],['security_deposit','Deposit'],['advance_months','Advance months'],['charges','Additional charges'],['inclusions','Inclusions'],['house_rules','House rules']];const changed=fields.filter(([key])=>JSON.stringify(previous[key])!==JSON.stringify(current[key]));return <div className="application-feedback"><h4>Changes from the previous offer</h4>{changed.length?<ul>{changed.map(([key,label])=><li key={key}>{label}: {typeof current[key]==='object'?'Updated; review the breakdown below':String(previous[key]??'Unconfirmed')+' to '+String(current[key]??'Unconfirmed')}</li>)}</ul>:<p>Terms were reissued with no listed field changes.</p>}</div>}
