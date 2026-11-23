import { isLiveWorkspace } from './workspaceSession'
import { getCurrentResident } from './residentsData'
import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import { CURRENT_RESIDENT, useHoldingState } from './holdingData'
import { getMaintenanceTickets } from './maintenanceData'
import { getResidentProfile } from './profileData'
import { getBillingSummary, getVisitorEntries, money } from './residentData'
import { usePreviewData } from './previewStore'
import ResidentTools from './ResidentTools'

const asset = (name: string) => `./assets/dashboard/${name}`

const metrics = [
  { value: '₱3,500', label: 'Upcoming rent', icon: 'icon-wallet-metric.svg', href: '#/resident/payments' },
  { value: '02', label: 'Items for pickup', icon: 'icon-box-metric.svg', href: '#/resident/holding-station' },
  { value: '01', label: 'Active maintenance ticket', icon: 'icon-ticket-metric.svg', href: '#/resident/maintenance' },
  { value: '03', label: 'Recent guest entries', icon: 'icon-book-metric.svg', href: '#/resident/logbook' },
]

const services = [
  { title: 'Logbook', description: 'Visitors & access history', icon: 'icon-book-service.svg', href: '#/resident/logbook' },
  { title: 'Maintenance', description: 'Submit service requests', icon: 'icon-wrench-service.svg', href: '#/resident/maintenance' },
  { title: 'Holding station', description: 'Packages at the desk', icon: 'icon-box-service.svg', href: '#/resident/holding-station' },
  { title: 'Payments', description: 'Dues & receipts', icon: 'icon-wallet-service.svg', href: '#/resident/payments' },
]

export default function ResidentDashboard() {
  const { state: holdingState, loadError: holdingError } = useHoldingState()
  const pickupCount = (isLiveWorkspace() ? holdingState.items : holdingState.items.filter(item => item.residentId === CURRENT_RESIDENT))
    .filter(item => item.status === 'Ready').length
  const [notice, setNotice] = useState('')
  const [servicesOpen, setServicesOpen] = useState(false)
  const profile = usePreviewData(getResidentProfile)
  const tickets = usePreviewData(getMaintenanceTickets)
  const bill = usePreviewData(getBillingSummary)
  const visitorEntries = usePreviewData(getVisitorEntries)
  const resident = usePreviewData(getCurrentResident)
  const hasBillDue = bill.balance > 0 && (!isLiveWorkspace() || bill.posted)
  const showPickup = !hasBillDue && pickupCount > 0
  const values: Record<string, string> = {
    'Upcoming rent': money(isLiveWorkspace()&&!bill.posted?bill.agreedMonthly:bill.balance),
    'Items for pickup': holdingError ? '—' : String(pickupCount).padStart(2, '0'),
    'Active maintenance ticket': String(tickets.filter(ticket => ticket.status !== 'Resolved').length).padStart(2, '0'),
    'Recent guest entries': String(visitorEntries.length).padStart(2, '0'),
  }

  useEffect(() => {
    document.title = 'Resident dashboard | Haruhay'
  }, [])

  function preview() {
    setServicesOpen(true)
  }

  return <ResidentLayout
    activeSection="Dashboard"
    breadcrumb="Dashboard"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content">
      {holdingError && <p className="resident-inline-error" role="alert">{holdingError}</p>}
      <header className="resident-page-heading">
        <span>YOUR SPACE&nbsp; / &nbsp;ROOM {resident.room}</span>
        <h1>Welcome home, {profile.fullName.trim().split(/\s+/u)[0]}!</h1>
        <p>Another day in a space that cares for you.</p>
      </header>

      <section className="resident-welcome resident-next-task" aria-labelledby="resident-welcome-title">
        <img className="resident-welcome-stars" src={asset('motif-stars.svg')} width="92" height="114" alt="" />
        <img className="resident-welcome-heart" src={asset('icon-heart-welcome.svg')} width="45" height="45" alt="" />
        <h2 id="resident-welcome-title">{hasBillDue ? 'Your next bill' : showPickup ? 'A package is ready for pickup' : 'Your stay at a glance'}</h2>
        <p>{hasBillDue ? money(bill.balance) + ' due · ' + bill.dueLabel : showPickup ? pickupCount + (pickupCount === 1 ? ' item is' : ' items are') + ' waiting at the Holding Station.' : 'Check your payments, packages, and requests below.'}</p>
        <a className="admin-primary" href={showPickup ? '#/resident/holding-station' : '#/resident/payments'}>{showPickup ? 'View packages' : 'View payments'}</a>
      </section>

      <section className="resident-metrics" aria-label="Your stay at a glance">
        {metrics.map(metric => {
          const content = <>
            <span className="resident-card-icon"><img src={asset(metric.icon)} width="24" height="24" alt="" /></span>
            <strong>{values[metric.label]}</strong>
            <span>{metric.label==='Upcoming rent'&&isLiveWorkspace()&&!bill.posted?'Agreed monthly charges':metric.label}</span>
          </>
          return metric.href
            ? <a className="resident-metric-card" href={metric.href} key={metric.label}>{content}</a>
            : <button className="resident-metric-card" type="button" key={metric.label} onClick={preview}>{content}</button>
        })}
      </section>

      <section className="resident-explore" aria-labelledby="resident-explore-title">
        <div className="resident-section-heading">
          <h2 id="resident-explore-title">Explore Haruhay</h2>
          <button type="button" onClick={preview}>All services <span aria-hidden="true">→</span></button>
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
                : <button className="resident-service-card" type="button" key={service.title} onClick={preview}>{content}</button>
            })}
          </div>
          {(!isLiveWorkspace() || bill.posted) && <a className="resident-heads-up" href="#/resident/payments">
            <strong>Heads up</strong>
            <span className="resident-due-date">{bill.dueLabel.toUpperCase()}</span>
            <b>Rent due</b>
            <span>{bill.timing}</span>
          </a>}
        </div>
      </section>
    </div>
    {servicesOpen && <ResidentTools mode="services" onClose={() => setServicesOpen(false)} />}
  </ResidentLayout>
}
