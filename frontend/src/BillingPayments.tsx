import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './Billing.css'
import ResidentDialog from './ResidentDialog'
import { billDueLabel, billTiming, getPaymentChannel, money, paymentChannels, savePaymentChannel, upcomingBill, upcomingTotal } from './residentData'
import type { PaymentChannel } from './residentData'
import { usePreviewData } from './previewStore'

const asset = (name: string) => `./assets/dashboard/${name}`

const billingCenter = [
  {
    title: 'Upcoming payments',
    description: 'See when your next rent is due.',
    icon: 'billing-calendar.svg',
    action: 'upcoming',
  },
  {
    title: 'Payment history',
    description: 'Browse and download receipts.',
    icon: 'billing-file.svg',
    href: '#/resident/payments/history',
  },
  {
    title: 'Payment methods',
    description: 'Manage your preferred channels.',
    icon: 'icon-wallet-service.svg',
    action: 'methods',
  },
] as const

export default function BillingPayments() {
  const [notice, setNotice] = useState('')
  const channel = usePreviewData(getPaymentChannel)
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannel>(channel)
  const [panel, setPanel] = useState<'upcoming' | 'methods' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'Payments & billing | Haruhay'
  }, [])

  function preview(action: 'upcoming' | 'methods') {
    setSelectedChannel(channel)
    setError('')
    setPanel(action)
  }

  return <ResidentLayout
    activeSection="Payments"
    breadcrumb="Payments"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content billing-content">
      <header className="resident-page-heading">
        <span>MONTHLY DUES</span>
        <h1>Payments &amp; billing</h1>
        <p>Your rent, utilities, and receipts — in one organized place.</p>
      </header>

      <section className="billing-overview" aria-label="October billing overview">
        <article className="billing-balance">
          <img className="billing-balance-circle" src={asset('billing-balance-circle.svg')} width="233" height="233" alt="" />
          <span>TOTAL UPCOMING</span>
          <strong>{money(upcomingTotal)}</strong>
          <p>{upcomingBill.period} rent and utilities</p>
          <time dateTime={upcomingBill.due}>DUE {billDueLabel.toUpperCase()}</time>
        </article>

        <article className="billing-breakdown">
          <h2>Payment breakdown</h2>
          <dl>
            <div><dt>Monthly rent</dt><dd>{money(upcomingBill.rent)}</dd></div>
            <div><dt>Utilities</dt><dd>{money(upcomingBill.utilities)}</dd></div>
            <div><dt>Outstanding balance</dt><dd>{money(upcomingBill.outstanding)}</dd></div>
          </dl>
        </article>
      </section>

      <section className="billing-center" aria-labelledby="billing-center-title">
        <div className="billing-section-heading">
          <h2 id="billing-center-title">Your billing center</h2>
          <a href="#/resident/payments/history">View all <span aria-hidden="true">→</span></a>
        </div>

        <div className="billing-center-grid">
          {billingCenter.map(item => {
            const content = <>
              <span className="billing-center-icon"><img src={asset(item.icon)} width="26" height="26" alt="" /></span>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </>

            return 'href' in item
              ? <a className="billing-center-card" href={item.href} key={item.title}>{content}</a>
              : <button className="billing-center-card" type="button" onClick={() => preview(item.action)} key={item.title}>{content}</button>
          })}
        </div>
      </section>
      <p className="resident-preview-label">Sample billing period: {upcomingBill.period} · Preferred channel: {channel}. No payments are processed.</p>
    </div>
    {panel && <ResidentDialog title={panel === 'upcoming' ? 'Upcoming payments' : 'Payment methods'} eyebrow="MONTHLY DUES" onClose={() => setPanel(null)}>
      {panel === 'upcoming' ? <><div className="dialog-body"><p><strong>{upcomingBill.period} · {money(upcomingTotal)}</strong></p><p>Sample due date: {billDueLabel}, 2026. {billTiming()}.</p><p>Rent {money(upcomingBill.rent)} + utilities {money(upcomingBill.utilities)}. Preferred channel: {channel}.</p><p>For actual balances and payment instructions, check with the front desk. This preview cannot accept or submit payments.</p><a href="#/resident/payments/history" onClick={() => setPanel(null)}>View payment history</a></div><button className="dialog-primary" onClick={() => setPanel(null)}>Done</button></> : <form onSubmit={event => { event.preventDefault(); try { savePaymentChannel(selectedChannel); setPanel(null); setNotice('Preferred payment channel saved locally.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not save your preference.') } }}>
        <div className="dialog-body"><p>Choose your preferred channel. Only the channel name is stored; no account or financial details are collected.</p><fieldset><legend>Preferred payment channel</legend>{paymentChannels.map(value => <label className="dialog-choice" key={value}><input type="radio" name="channel" value={value} checked={selectedChannel === value} onChange={() => setSelectedChannel(value)} />{value}</label>)}</fieldset><p>Confirm actual payment instructions with the front desk.</p></div>
        {error && <p className="dialog-error" role="alert">{error}</p>}<button className="dialog-primary">Save preference (preview)</button>
      </form>}
    </ResidentDialog>}
  </ResidentLayout>
}
