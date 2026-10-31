import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './Billing.css'

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

  useEffect(() => {
    document.title = 'Payments & billing | Haruhay'
  }, [])

  function preview(action: 'upcoming' | 'methods') {
    setNotice(action === 'upcoming'
      ? 'Your next preview payment is ₱3,500.00, due October 15.'
      : 'Payment method management is a frontend preview; no financial details are stored.')
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
          <strong>₱3,500.00</strong>
          <p>October rent and utilities</p>
          <time dateTime="2026-10-15">DUE OCTOBER 15</time>
        </article>

        <article className="billing-breakdown">
          <h2>Payment breakdown</h2>
          <dl>
            <div><dt>Monthly rent</dt><dd>₱3,000.00</dd></div>
            <div><dt>Utilities</dt><dd>₱500.00</dd></div>
            <div><dt>Outstanding balance</dt><dd>₱0.00</dd></div>
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
    </div>
  </ResidentLayout>
}
