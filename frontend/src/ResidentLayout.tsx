import { getWorkspaceSession, hasActiveStay, hasEndedStay, hasPendingApplication, signOutWorkspace } from './workspaceSession'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent, ReactNode } from 'react'
import './ResidentDashboard.css'
import { getResidentProfile, profileInitials } from './profileData'
import ResidentTools from './ResidentTools'
import ResidentInbox from './ResidentInbox'
import { getNotifications } from './residentToolsData'
import { api } from './registrationApi'
import { getReadNotifications } from './residentData'
import { usePreviewData } from './previewStore'

const asset = (name: string) => `./assets/dashboard/${name}`

export type ResidentSection = 'Dashboard' | 'Logbook' | 'Maintenance' | 'Holding station' | 'Payments' | 'Community' | 'My profile' | 'Application status'

const navigation: Array<{ label: ResidentSection; icon: string; href?: string }> = [
  { label: 'Dashboard', icon: 'icon-home.svg', href: '#/resident/dashboard' },
  { label: 'Logbook', icon: 'icon-book-nav.svg', href: '#/resident/logbook' },
  { label: 'Maintenance', icon: 'icon-ticket-nav.svg', href: '#/resident/maintenance' },
  { label: 'Holding station', icon: 'icon-box-nav.svg', href: '#/resident/holding-station' },
  { label: 'Payments', icon: 'icon-wallet-nav.svg', href: '#/resident/payments' },
  { label: 'Community', icon: 'icon-heart-nav.svg', href: '#/resident/community' },
  { label: 'My profile', icon: 'icon-user-nav.svg', href: '#/resident/profile' },
]

type OpenPanel = 'account' | null

type ResidentLayoutProps = {
  activeSection: ResidentSection
  breadcrumb: string
  notice: string
  onNotice: (message: string) => void
  onDismissNotice: () => void
  children: ReactNode
}

export default function ResidentLayout({ activeSection, breadcrumb, notice, onNotice, onDismissNotice, children }: ResidentLayoutProps) {
  const live = getWorkspaceSession()
  const limited = Boolean(live && !hasActiveStay(live.applications))
  const billingOnly = Boolean(limited && live && hasEndedStay(live.applications))
  const showApplication = limited && (!billingOnly || Boolean(live && hasPendingApplication(live.applications)))
  async function signout(event: MouseEvent<HTMLAnchorElement>) {
    if (!live) return
    event.preventDefault()
    try { await signOutWorkspace() }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Could not sign out. Please try again.') }
  }
  const [profile, setProfile] = useState(getResidentProfile)
  useEffect(() => {
    const update = () => setProfile(getResidentProfile())
    window.addEventListener('haruhay-profile-updated', update)
    return () => window.removeEventListener('haruhay-profile-updated', update)
  }, [])
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 980px)').matches)
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null)
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState<'search' | 'support' | 'services' | 'notifications' | null>(null)
  const notifications = usePreviewData(getNotifications)
  const readNotifications = usePreviewData(getReadNotifications)
  const [liveUnread, setLiveUnread] = useState<number | null>(null)
  const liveAccount = live?.account.id
  const unread = live ? liveUnread ?? 0 : notifications.filter(item => !readNotifications.includes(item.id)).length
  useEffect(() => {
    if (!liveAccount || limited) return
    let active = true
    api<{ unread: number }>('/resident/notifications/unread-count').then(result => {
      if (active) setLiveUnread(current => current ?? result.unread)
    }).catch(() => { /* The inbox shows an error and retry if records are unavailable. */ })
    return () => { active = false }
  }, [liveAccount, limited])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!navigationOpen || !narrow) return
    const previousOverflow = document.body.style.overflow
    const returnFocus = menuButton.current
    document.body.style.overflow = 'hidden'
    const links = () => Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
    links()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = links()
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', trap)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', trap); returnFocus?.focus() }
  }, [navigationOpen, narrow])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavigationOpen(false)
        setOpenPanel(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  function preview() {
    setTool('services')
    setNavigationOpen(false)
    setOpenPanel(null)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTool('search')
    setOpenPanel(null)
  }

  return <main className="resident-dashboard">
    <a className="ux-skip" href="#resident-main" onClick={event => { event.preventDefault(); document.getElementById('resident-main')?.focus() }}>Skip to content</a>
    <button
      className={'resident-sidebar-backdrop ' + (navigationOpen ? 'is-open' : '')}
      type="button"
      aria-label="Close navigation"
      tabIndex={-1}
      aria-hidden={!navigationOpen}
      onClick={() => setNavigationOpen(false)}
    />

    <aside ref={sidebar} inert={narrow && !navigationOpen} id="resident-navigation" className={'resident-sidebar ' + (navigationOpen ? 'is-open' : '')} aria-label="Resident portal navigation">
      <a className="resident-brand" href={billingOnly ? '#/resident/payments' : limited ? '#/account/status' : '#/resident/dashboard'} aria-label="Haruhay home">
        <img src={asset('haruhay-mark.png')} width="56" height="56" alt="" />
        <img src={asset('haruhay-wordmark.png')} width="172" height="46" alt="Haruhay" />
      </a>

      <nav className="resident-nav" aria-label="Resident portal">
        <p>{billingOnly ? 'FORMER RESIDENT' : limited ? 'YOUR APPLICATION' : 'RESIDENT PORTAL'}</p>
        {showApplication && <a className={activeSection === 'Application status' ? 'active' : ''} aria-current={activeSection === 'Application status' ? 'page' : undefined} href="#/account/status" onClick={() => setNavigationOpen(false)}><img src={asset('icon-book-nav.svg')} width="21" height="21" alt="" /><span>Application status</span></a>}
        {navigation.filter(item => !limited || (billingOnly && item.label === 'Payments')).map(item => {
          const className = item.label === activeSection ? 'active' : ''
          const content = <>
            <img src={asset(item.icon)} width="21" height="21" alt="" />
            <span>{item.label}</span>
          </>

          return item.href
            ? <a
                className={className}
                href={item.href}
                key={item.label}
                aria-current={item.label === activeSection ? 'page' : undefined}
                onClick={() => setNavigationOpen(false)}
              >{content}</a>
            : <button className={className} type="button" key={item.label} onClick={preview}>{content}</button>
        })}
      </nav>

      <div className="resident-sidebar-footer">
        <a className="resident-signout" href="#/login" onClick={signout}>Sign out</a>
        {limited ? <div className="resident-support application-sidebar-note"><span className="resident-support-title"><img src={asset('icon-shield.svg')} width="24" height="24" alt="" /><strong>{billingOnly ? 'Your billing records' : 'A place to belong.'}</strong></span><span>{billingOnly ? 'View past bills and receipts, or report a payment on an outstanding bill.' : 'Resident services open once your owner approves your stay.'}</span></div> : <button className="resident-support" type="button" onClick={() => { setTool('support'); setNavigationOpen(false) }}>
          <span className="resident-support-title">
            <img src={asset('icon-shield.svg')} width="24" height="24" alt="" />
            <strong>Here for you, always.</strong>
          </span>
          <span>Need support? Talk to our team.</span>
        </button>}
      </div>
    </aside>

    <section className="resident-workspace" inert={narrow && navigationOpen}>
      <header className="resident-topbar">
        <button
          ref={menuButton}
          className="resident-menu-button"
          type="button"
          aria-label="Open resident navigation"
          aria-controls="resident-navigation"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(true)}
        ><span /><span /><span /></button>
        <p className="resident-breadcrumb">My home / {breadcrumb}</p>

        <div className="resident-topbar-actions">
          {!limited && <><form className="resident-search" role="search" onSubmit={submitSearch}>
            <img src={asset('icon-search.svg')} width="19" height="19" alt="" />
            <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search Haruhay" placeholder="Search Haruhay..." />
          </form>
          <button type="button" className="resident-icon-button resident-search-launch" aria-label="Search Haruhay" onClick={() => setTool('search')}><img src={asset('icon-search.svg')} width="19" height="19" alt="" /></button>

          <div className="resident-popover-anchor">
            <button
              className="resident-icon-button"
              type="button"
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
              aria-haspopup="dialog"
              onClick={() => { setOpenPanel(null); setTool('notifications') }}
            >
              <img src={asset('icon-bell.svg')} width="21" height="21" alt="" />
              {unread > 0 && <img className="resident-notification-dot" src={asset('notification-dot.svg')} width="8" height="8" alt="" />}
            </button>
          </div></>}

          <div className="resident-popover-anchor">
            <button
              className="resident-account"
              type="button"
              aria-label="Open account menu"
              aria-expanded={openPanel === 'account'}
              onClick={() => setOpenPanel(openPanel === 'account' ? null : 'account')}
            >
              <span>{profileInitials(profile.fullName)}</span><strong>{profile.fullName.trim().split(/\s+/u)[0]} {profile.fullName.trim().split(/\s+/u).length > 1 ? Array.from(profile.fullName.trim().split(/\s+/u).at(-1) ?? '')[0] + '.' : ''}</strong>
            </button>
            {openPanel === 'account' && <div className="resident-popover resident-account-menu">
              {!limited && <a href="#/resident/profile" onClick={() => setOpenPanel(null)}>My profile</a>}
              <a href="#/login" onClick={signout}>Sign out</a>
            </div>}
          </div>
        </div>
      </header>

      <div className="ux-workspace-content" id="resident-main" tabIndex={-1}>{children}</div>
      {!limited && tool && (live && tool === 'notifications'
        ? <ResidentInbox onClose={() => setTool(null)} onUnreadChange={setLiveUnread} />
        : <ResidentTools mode={tool} initialQuery={search} onClose={() => setTool(null)} />)}

      <div className={'resident-status ux-toast ' + (notice ? 'is-visible' : '')} role="status" aria-live="polite">
        {notice}
        {notice && <button type="button" aria-label="Dismiss message" onClick={onDismissNotice}>×</button>}
      </div>
    </section>
  </main>
}
