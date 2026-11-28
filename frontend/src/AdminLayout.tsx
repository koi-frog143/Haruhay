import { getWorkspaceSession, signOutWorkspace } from './workspaceSession'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AdminIcon } from './AdminUI'
import ResidentDialog from './ResidentDialog'
import MaintenanceNotifications from './MaintenanceNotifications'
import { maintenanceSnapshot } from './maintenanceApi'
import { getResidents } from './residentsData'
import { getAllMaintenanceTickets } from './maintenanceData'
import { getAllAnnouncements } from './announcementData'
import { getPropertyBilling } from './billingData'
import { getVisitorRequests } from './visitorData'
import { usePreviewData } from './previewStore'
import { getSettings } from './settingsData'

export type AdminSection = 'Dashboard' | 'Residents' | 'Visitor logbook' | 'Maintenance' | 'Holding station' | 'Billing & payments' | 'Announcements' | 'Settings' | 'Applications' | 'Property & rooms' | 'Support'
const navigation: Array<{ label: AdminSection; href: string; icon: string }> = [
  { label: 'Dashboard', href: '#/admin/dashboard', icon: 'imgIconHome' }, { label: 'Residents', href: '#/admin/residents', icon: 'imgIconUsers' }, { label: 'Visitor logbook', href: '#/admin/logbook', icon: 'imgIconBook' }, { label: 'Maintenance', href: '#/admin/maintenance', icon: 'imgIconWrench' }, { label: 'Holding station', href: '#/admin/holding-station', icon: 'imgIconBox' }, { label: 'Billing & payments', href: '#/admin/billing', icon: 'imgIconWallet' }, { label: 'Announcements', href: '#/admin/announcements', icon: 'imgIconMegaphone' }, { label: 'Settings', href: '#/admin/settings', icon: 'imgIconSettings' },
]
type Props = { active: AdminSection; node: string; children: ReactNode; notice?: string; onDismissNotice?: () => void }
export default function AdminLayout({ active, node, children, notice = '', onDismissNotice }: Props) {
  const live = getWorkspaceSession()
  const items: typeof navigation = live ? [...navigation,
    { label: 'Applications', href: '#/admin/applications', icon: 'imgIconUsers' },
    { label: 'Property & rooms', href: '#/admin/property', icon: 'imgIconSettings' },
    { label: 'Support', href: '#/admin/support', icon: 'imgIconBook' },
  ] : navigation
  const groups: { title: string; links: AdminSection[] }[] = [
    { title: 'Overview', links: ['Dashboard', 'Applications', 'Residents'] },
    { title: 'Operations', links: ['Visitor logbook', 'Maintenance', 'Holding station', 'Billing & payments', 'Support'] },
    { title: 'Property', links: ['Property & rooms', 'Announcements', 'Settings'] },
  ]
  const [liveError, setLiveError] = useState('')
  const signout = async (event: React.MouseEvent<HTMLAnchorElement>) => { if (!live) return; event.preventDefault(); try { await signOutWorkspace() } catch { setLiveError('Unable to sign out. Please try again.') } }
  const [navOpen, setNavOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 980px)').matches)
  const [accountOpen, setAccountOpen] = useState(false)
  const [panel, setPanel] = useState<'search' | 'notifications' | 'support' | null>(null)
  const [query, setQuery] = useState('')
  const menu = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const account = useRef<HTMLButtonElement>(null)
  const residents = usePreviewData(getResidents)
  const tickets = usePreviewData(getAllMaintenanceTickets)
  const announcements = usePreviewData(getAllAnnouncements)
  const billing = usePreviewData(getPropertyBilling)
  const requests = usePreviewData(getVisitorRequests)
  const settings = usePreviewData(getSettings)
  const maintenanceUnread = usePreviewData(maintenanceSnapshot).notices.filter(notice => !notice.read_at).length
  useEffect(() => { document.title = `${active} | Haruhay administration` }, [active])
  const attention = [
    ...tickets.filter(ticket => ticket.priority === 'High' && ticket.status !== 'Resolved').map(ticket => ({ title: ticket.title, detail: (ticket.workflowPriority ?? 'High') + ' priority · ' + ticket.location, href: `#/admin/maintenance/${ticket.id}` })),
    { title: `${billing.pending.length} payments to review`, detail: 'Open the payment review queue', href: '#/admin/payments/approvals' },
    { title: `${requests.filter(request => request.status === 'Pending review').length} pending visitor requests`, detail: 'Open the visitor logbook to review', href: '#/admin/logbook' },
  ]
  const entries = [
    ...items.map(item => ({ title: item.label, detail: 'Admin workspace', href: item.href })),
    ...residents.map(resident => ({ title: resident.fullName, detail: `${resident.id} · Room ${resident.room}`, href: `#/admin/residents/${resident.id}` })),
    ...tickets.map(ticket => ({ title: ticket.title, detail: `${ticket.ticketNumber ?? ticket.id} · ${ticket.workflowStatus ?? ticket.status}`, href: `#/admin/maintenance/${ticket.id}` })),
    ...announcements.map(item => ({ title: item.title, detail: 'Announcement · ' + (item.published ? 'Published' : 'Draft'), href: '#/admin/announcements' })),
  ]
  const results = query.trim() ? entries.filter(item => query.toLowerCase().trim().split(/\s+/u).every(term => `${item.title} ${item.detail}`.toLowerCase().includes(term))) : []
  useEffect(() => { const media = matchMedia('(max-width: 980px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNavOpen(false); setAccountOpen(false); if (document.activeElement?.closest('.admin-account-menu')) account.current?.focus() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  useEffect(() => {
    if (!navOpen || !narrow) return
    const previous = document.body.style.overflow
    const trigger = menu.current
    document.body.style.overflow = 'hidden'
    const links = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button') ?? [])
    links()[0]?.focus()
    const trap = (event: KeyboardEvent) => { if (event.key !== 'Tab') return; const controls = links(); if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() } }
    window.addEventListener('keydown', trap)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', trap); trigger?.focus() }
  }, [navOpen, narrow])
  return <main className="admin-shell">
    <a className="ux-skip" href="#admin-main" onClick={event => { event.preventDefault(); document.getElementById('admin-main')?.focus() }}>Skip to content</a>
    <button className={'admin-backdrop ' + (navOpen ? 'is-open' : '')} tabIndex={-1} aria-hidden={!navOpen} aria-label="Close admin navigation" onClick={() => setNavOpen(false)} />
    <aside ref={sidebar} id="admin-navigation" className={'admin-sidebar ' + (navOpen ? 'is-open' : '')} inert={narrow && !navOpen} aria-label="Administrator navigation">
      <a className="admin-brand" href="#/admin/dashboard" aria-label="Haruhay administrator home"><AdminIcon node={node} name="imgHaruhayFinalWebFallbackMark" /><AdminIcon node={node} name="imgHaruhayFinalWebFallbackWordmark" /></a>
      <nav aria-label="Admin workspace">{groups.map(group => <ul className="ux-nav-group" key={group.title}>
        <li><p>{group.title}</p></li>
        {group.links.map(label => {
          const item = items.find(link => link.label === label)
          return item && <li key={label}><a className={label === active ? 'active' : ''} aria-current={label === active ? 'page' : undefined} href={item.href} onClick={() => setNavOpen(false)}><AdminIcon node={node} name={item.icon} />{label}</a></li>
        })}
      </ul>)}</nav>
      <div className="admin-sidebar-footer"><a href="#/login" onClick={signout}>{live ? 'Sign out' : 'Sign out of preview'}</a><button className="admin-support" onClick={() => { setPanel('support'); setNavOpen(false) }}><span><AdminIcon node={node} name="imgIconShield" /><strong>Here for you, always.</strong></span><small>Need support? Talk to our team.</small></button></div>
    </aside>
    <section className="admin-workspace" inert={narrow && navOpen}>
      <header className="admin-topbar"><button className="admin-menu-button" ref={menu} aria-label="Open admin navigation" aria-expanded={navOpen} aria-controls="admin-navigation" onClick={() => setNavOpen(true)}><span /><span /><span /></button><p>Administration / {active}</p><div className="admin-topbar-actions"><form className="admin-search" role="search" onSubmit={event => { event.preventDefault(); setPanel('search') }}><AdminIcon node={node} name="imgIconSearch" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Haruhay..." aria-label="Search administrator records" /></form><button className="admin-mobile-search" aria-label="Search administrator records" onClick={() => setPanel('search')}><AdminIcon node={node} name="imgIconSearch" /></button><button className="admin-bell" aria-label={maintenanceUnread ? `Admin notifications (${maintenanceUnread} unread)` : 'Admin notifications'} onClick={() => setPanel('notifications')}><AdminIcon node={node} name="imgIconBell" />{(!live || maintenanceUnread > 0) && <AdminIcon node={node} name="imgDecorativeCircle" className="admin-notification-dot" />}</button><div className="admin-account-anchor"><button className="admin-account" ref={account} aria-expanded={accountOpen} aria-label="Open administrator account menu" onClick={() => setAccountOpen(!accountOpen)}><span>{live ? live.account.full_name.split(/\s+/u).map(n => n[0]).slice(0, 2).join('') : 'JD'}</span><strong>{live?.account.full_name || 'Joy D.'}</strong></button>{accountOpen && <nav className="admin-account-menu"><a href="#/admin/settings" onClick={() => setAccountOpen(false)}>Settings & permissions</a>{!live && <a href="#/resident/dashboard">Resident preview</a>}<a href="#/login" onClick={signout}>{live ? 'Sign out' : 'Sign out of preview'}</a></nav>}</div></div></header>
      <div className="admin-content" id="admin-main" tabIndex={-1}>{liveError && <p role="alert">{liveError}</p>}{children}{!live && <p className="admin-preview-note"><span className="ux-preview-label">Sample preview</span> Changes stay in this browser session.</p>}</div>
      {notice && <div className="admin-toast ux-toast" role="status" aria-live="polite">{notice}<button aria-label="Dismiss message" onClick={onDismissNotice}>×</button></div>}
      {panel && <ResidentDialog title={panel === 'search' ? 'Search Haruhay' : panel === 'notifications' ? 'Admin notifications' : 'Property support'} footerNote={live ? "" : undefined} onClose={() => setPanel(null)}><div className="dialog-body">{panel === 'search' ? <><label>Search pages, residents and tickets<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><p role="status">{query.trim() ? `${results.length} results` : 'Enter a search term.'}</p><ul className="dialog-list">{results.map((item, index) => <li key={index}><a href={item.href} onClick={() => setPanel(null)}>{item.title}</a><small>{item.detail}</small></li>)}</ul></> : panel === 'notifications' ? <>{live && <MaintenanceNotifications role="owner" onNavigate={() => setPanel(null)} />}<ul className="dialog-list">{attention.map(item => <li key={item.href}><a href={item.href} onClick={() => setPanel(null)}>{item.title}</a><small>{item.detail}</small></li>)}</ul></> : <><p>{settings.property.name}</p><p>{settings.property.contact}</p><p>Contact your property team directly for help.</p><a href="#/admin/settings" onClick={() => setPanel(null)}>Manage property contact details</a></>}</div></ResidentDialog>}
    </section>
  </main>
}
