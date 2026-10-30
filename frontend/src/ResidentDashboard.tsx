import { useEffect, useState } from 'react'
import './ResidentDashboard.css'

const asset = (name: string) => `./assets/dashboard/${name}`

const navigation = [
  { label: 'Dashboard', icon: 'icon-home.svg', active: true },
  { label: 'Logbook', icon: 'icon-book-nav.svg' },
  { label: 'Maintenance', icon: 'icon-ticket-nav.svg' },
  { label: 'Holding station', icon: 'icon-box-nav.svg' },
  { label: 'Payments', icon: 'icon-wallet-nav.svg' },
  { label: 'Community', icon: 'icon-heart-nav.svg' },
  { label: 'My profile', icon: 'icon-user-nav.svg' },
]

const metrics = [
  { value: '₱3,500', label: 'Upcoming rent', icon: 'icon-wallet-metric.svg' },
  { value: '02', label: 'Items for pickup', icon: 'icon-box-metric.svg' },
  { value: '01', label: 'Active maintenance ticket', icon: 'icon-ticket-metric.svg' },
  { value: '03', label: 'Recent guest entries', icon: 'icon-book-metric.svg' },
]

const services = [
  { title: 'Logbook', description: 'Visitors & access history', icon: 'icon-book-service.svg' },
  { title: 'Maintenance', description: 'Submit service requests', icon: 'icon-wrench-service.svg' },
  { title: 'Holding station', description: 'Packages at the desk', icon: 'icon-box-service.svg' },
  { title: 'Payments', description: 'Dues & receipts', icon: 'icon-wallet-service.svg' },
]

type OpenPanel = 'notifications' | 'account' | null

export default function ResidentDashboard() {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Resident dashboard | Haruhay'
  }, [])

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
    setNotice(`${label} is designed and ready for the next implementation phase.`)
    setNavigationOpen(false)
    setOpenPanel(null)
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = search.trim()
    setNotice(query ? `Search preview: “${query}”` : 'Enter something to search for in Haruhay.')
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
        {navigation.map(item => <button
          className={item.active ? 'active' : ''}
          type="button"
          key={item.label}
          aria-current={item.active ? 'page' : undefined}
          onClick={() => item.active ? setNavigationOpen(false) : preview(item.label)}
        >
          <img src={asset(item.icon)} width="21" height="21" alt="" />
          <span>{item.label}</span>
        </button>)}
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
        <p className="resident-breadcrumb">My home / Dashboard</p>

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

      <div className="resident-content">
        <header className="resident-page-heading">
          <span>YOUR SPACE&nbsp; / &nbsp;ROOM 204</span>
          <h1>Good morning, Andrea!</h1>
          <p>Another day in a space that cares for you.</p>
        </header>

        <section className="resident-welcome" aria-labelledby="resident-welcome-title">
          <img className="resident-welcome-stars" src={asset('motif-stars.svg')} width="92" height="114" alt="" />
          <img className="resident-welcome-heart" src={asset('icon-heart-welcome.svg')} width="45" height="45" alt="" />
          <h2 id="resident-welcome-title">Your little corner of belonging.</h2>
          <p>Everything about your stay, calmly in one place. Check in, stay informed, and let us handle the rest.</p>
          <span className="resident-room-badge">HOME&nbsp; • &nbsp;ROOM 204</span>
        </section>

        <section className="resident-metrics" aria-label="Your stay at a glance">
          {metrics.map(metric => <button className="resident-metric-card" type="button" key={metric.label} onClick={() => preview(metric.label)}>
            <span className="resident-card-icon"><img src={asset(metric.icon)} width="24" height="24" alt="" /></span>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </button>)}
        </section>

        <section className="resident-explore" aria-labelledby="resident-explore-title">
          <div className="resident-section-heading">
            <h2 id="resident-explore-title">Explore Haruhay</h2>
            <button type="button" onClick={() => preview('All services')}>All services <span aria-hidden="true">→</span></button>
          </div>
          <div className="resident-services-layout">
            <div className="resident-service-grid">
              {services.map(service => <button className="resident-service-card" type="button" key={service.title} onClick={() => preview(service.title)}>
                <span className="resident-card-icon service"><img src={asset(service.icon)} width="26" height="26" alt="" /></span>
                <strong>{service.title}</strong>
                <span>{service.description}</span>
              </button>)}
            </div>
            <button className="resident-heads-up" type="button" onClick={() => preview('Rent details')}>
              <strong>Heads up</strong>
              <span className="resident-due-date">OCT 15</span>
              <b>Rent due</b>
              <span>7 days remaining</span>
            </button>
          </div>
        </section>
      </div>

      <div className={'resident-status ' + (notice ? 'is-visible' : '')} role="status" aria-live="polite">
        {notice}
        {notice && <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button>}
      </div>
    </section>
  </main>
}
