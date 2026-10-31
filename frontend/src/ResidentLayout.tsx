import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './ResidentDashboard.css'

const asset = (name: string) => `./assets/dashboard/${name}`

export type ResidentSection = 'Dashboard' | 'Logbook' | 'Maintenance' | 'Holding station' | 'Payments' | 'Community' | 'My profile'

const navigation: Array<{ label: ResidentSection; icon: string; href?: string }> = [
  { label: 'Dashboard', icon: 'icon-home.svg', href: '#/resident/dashboard' },
  { label: 'Logbook', icon: 'icon-book-nav.svg', href: '#/resident/logbook' },
  { label: 'Maintenance', icon: 'icon-ticket-nav.svg', href: '#/resident/maintenance' },
  { label: 'Holding station', icon: 'icon-box-nav.svg' },
  { label: 'Payments', icon: 'icon-wallet-nav.svg', href: '#/resident/payments' },
  { label: 'Community', icon: 'icon-heart-nav.svg' },
  { label: 'My profile', icon: 'icon-user-nav.svg' },
]

type OpenPanel = 'notifications' | 'account' | null

type ResidentLayoutProps = {
  activeSection: ResidentSection
  breadcrumb: string
  notice: string
  onNotice: (message: string) => void
  onDismissNotice: () => void
  children: ReactNode
}

export default function ResidentLayout({ activeSection, breadcrumb, notice, onNotice, onDismissNotice, children }: ResidentLayoutProps) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null)
  const [search, setSearch] = useState('')

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

  function preview(label: string) {
    onNotice(`${label} is designed and ready for the next implementation phase.`)
    setNavigationOpen(false)
    setOpenPanel(null)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = search.trim()
    onNotice(query ? `Search preview: “${query}”` : 'Enter something to search for in Haruhay.')
    setOpenPanel(null)
  }

  return <main className="resident-dashboard">
    <button
      className={'resident-sidebar-backdrop ' + (navigationOpen ? 'is-open' : '')}
      type="button"
      aria-label="Close navigation"
      onClick={() => setNavigationOpen(false)}
    />

    <aside id="resident-navigation" className={'resident-sidebar ' + (navigationOpen ? 'is-open' : '')} aria-label="Resident portal navigation">
      <a className="resident-brand" href="#/" aria-label="Haruhay home">
        <img src={asset('haruhay-mark.png')} width="56" height="56" alt="" />
        <img src={asset('haruhay-wordmark.png')} width="172" height="46" alt="Haruhay" />
      </a>

      <nav className="resident-nav" aria-label="Resident portal">
        <p>RESIDENT PORTAL</p>
        {navigation.map(item => {
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
            : <button className={className} type="button" key={item.label} onClick={() => preview(item.label)}>{content}</button>
        })}
      </nav>

      <div className="resident-sidebar-footer">
        <a className="resident-signout" href="#/login">Sign out</a>
        <button className="resident-support" type="button" onClick={() => preview('Resident support')}>
          <span className="resident-support-title">
            <img src={asset('icon-shield.svg')} width="24" height="24" alt="" />
            <strong>Here for you, always.</strong>
          </span>
          <span>Need support? Talk to our team.</span>
        </button>
      </div>
    </aside>

    <section className="resident-workspace">
      <header className="resident-topbar">
        <button
          className="resident-menu-button"
          type="button"
          aria-label="Open resident navigation"
          aria-controls="resident-navigation"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(true)}
        ><span /><span /><span /></button>
        <p className="resident-breadcrumb">My home / {breadcrumb}</p>

        <div className="resident-topbar-actions">
          <form className="resident-search" role="search" onSubmit={submitSearch}>
            <img src={asset('icon-search.svg')} width="19" height="19" alt="" />
            <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search Haruhay" placeholder="Search Haruhay..." />
          </form>

          <div className="resident-popover-anchor">
            <button
              className="resident-icon-button"
              type="button"
              aria-label="Notifications"
              aria-expanded={openPanel === 'notifications'}
              onClick={() => setOpenPanel(openPanel === 'notifications' ? null : 'notifications')}
            >
              <img src={asset('icon-bell.svg')} width="21" height="21" alt="" />
              <img className="resident-notification-dot" src={asset('notification-dot.svg')} width="8" height="8" alt="" />
            </button>
            {openPanel === 'notifications' && <div className="resident-popover resident-notifications" role="status">
              <strong>You’re all caught up.</strong>
              <span>New community updates will appear here.</span>
            </div>}
          </div>

          <div className="resident-popover-anchor">
            <button
              className="resident-account"
              type="button"
              aria-label="Open account menu"
              aria-expanded={openPanel === 'account'}
              onClick={() => setOpenPanel(openPanel === 'account' ? null : 'account')}
            >
              <span>AS</span><strong>Andrea S.</strong>
            </button>
            {openPanel === 'account' && <div className="resident-popover resident-account-menu">
              <button type="button" onClick={() => preview('My profile')}>My profile</button>
              <a href="#/login">Sign out</a>
            </div>}
          </div>
        </div>
      </header>

      {children}

      <div className={'resident-status ' + (notice ? 'is-visible' : '')} role="status" aria-live="polite">
        {notice}
        {notice && <button type="button" aria-label="Dismiss message" onClick={onDismissNotice}>×</button>}
      </div>
    </section>
  </main>
}
