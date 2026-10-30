import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'

const asset = (name: string) => `./assets/dashboard/${name}`

const metrics = [
  { value: '₱3,500', label: 'Upcoming rent', icon: 'icon-wallet-metric.svg' },
  { value: '02', label: 'Items for pickup', icon: 'icon-box-metric.svg' },
  { value: '01', label: 'Active maintenance ticket', icon: 'icon-ticket-metric.svg' },
  { value: '03', label: 'Recent guest entries', icon: 'icon-book-metric.svg', href: '#/resident/logbook' },
]

const services = [
  { title: 'Logbook', description: 'Visitors & access history', icon: 'icon-book-service.svg', href: '#/resident/logbook' },
  { title: 'Maintenance', description: 'Submit service requests', icon: 'icon-wrench-service.svg' },
  { title: 'Holding station', description: 'Packages at the desk', icon: 'icon-box-service.svg' },
  { title: 'Payments', description: 'Dues & receipts', icon: 'icon-wallet-service.svg' },
]

export default function ResidentDashboard() {
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Resident dashboard | Haruhay'
  }, [])

  function preview(label: string) {
    setNotice(`${label} is designed and ready for the next implementation phase.`)
  }

  return <ResidentLayout
    activeSection="Dashboard"
    breadcrumb="Dashboard"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
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
        {metrics.map(metric => {
          const content = <>
            <span className="resident-card-icon"><img src={asset(metric.icon)} width="24" height="24" alt="" /></span>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </>
          return metric.href
            ? <a className="resident-metric-card" href={metric.href} key={metric.label}>{content}</a>
            : <button className="resident-metric-card" type="button" key={metric.label} onClick={() => preview(metric.label)}>{content}</button>
        })}
      </section>

      <section className="resident-explore" aria-labelledby="resident-explore-title">
        <div className="resident-section-heading">
          <h2 id="resident-explore-title">Explore Haruhay</h2>
          <button type="button" onClick={() => preview('All services')}>All services <span aria-hidden="true">→</span></button>
        </div>
        <div className="resident-services-layout">
          <div className="resident-service-grid">
            {services.map(service => {
              const content = <>
                <span className="resident-card-icon service"><img src={asset(service.icon)} width="26" height="26" alt="" /></span>
                <strong>{service.title}</strong>
                <span>{service.description}</span>
              </>
              return service.href
                ? <a className="resident-service-card" href={service.href} key={service.title}>{content}</a>
                : <button className="resident-service-card" type="button" key={service.title} onClick={() => preview(service.title)}>{content}</button>
            })}
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
  </ResidentLayout>
}
