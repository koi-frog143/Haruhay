import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './Billing.css'

const asset = (name: string) => `./assets/dashboard/${name}`

type PaymentStatus = 'Paid' | 'Pending'
type PaymentFilter = 'All transactions' | PaymentStatus

type Payment = {
  period: string
  date: string
  method: string
  amount: string
  status: PaymentStatus
}

const payments: Payment[] = [
  { period: 'September 2026', date: 'Sep 14, 2026', method: 'GCash', amount: '₱3,500', status: 'Paid' },
  { period: 'August 2026', date: 'Aug 13, 2026', method: 'GCash', amount: '₱3,500', status: 'Paid' },
  { period: 'July 2026', date: 'Jul 15, 2026', method: 'Bank transfer', amount: '₱3,500', status: 'Paid' },
  { period: 'June 2026', date: 'Jun 12, 2026', method: 'GCash', amount: '₱3,500', status: 'Paid' },
  { period: 'May 2026', date: 'May 15, 2026', method: 'Bank transfer', amount: '₱3,500', status: 'Paid' },
]

const filters: PaymentFilter[] = ['All transactions', 'Paid', 'Pending']

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export default function PaymentHistory() {
  const [filter, setFilter] = useState<PaymentFilter>('All transactions')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Payment history | Haruhay'
  }, [])

  const visiblePayments = useMemo(() => payments.filter(payment => (
    filter === 'All transactions' || payment.status === filter
  )), [filter])

  function exportReceipts() {
    const rows = [
      ['Billing period', 'Date paid', 'Method', 'Amount', 'Payment status'],
      ...visiblePayments.map(payment => [payment.period, payment.date, payment.method, payment.amount, payment.status]),
    ]
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'haruhay-payment-history.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${visiblePayments.length} payment record${visiblePayments.length === 1 ? '' : 's'} as CSV.`)
  }

  return <ResidentLayout
    activeSection="Payments"
    breadcrumb="Payments"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content billing-content payment-history-content">
      <header className="resident-page-heading">
        <span>BILLING RECORDS</span>
        <h1>Payment history</h1>
        <p>Stay confident with a complete record of your past payments.</p>
      </header>

      <section className="payment-history" aria-labelledby="payment-history-title">
        <h2 className="visually-hidden" id="payment-history-title">Payment transactions</h2>
        <div className="payment-history-toolbar">
          <div className="payment-filters" aria-label="Filter payment history">
            {filters.map(option => <button
              className={`${filter === option ? 'active ' : ''}${option.toLowerCase().replace(' ', '-')}`}
              type="button"
              key={option}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >{option}</button>)}
          </div>
          <button className="payment-export" type="button" onClick={exportReceipts} disabled={visiblePayments.length === 0}>Export receipts</button>
        </div>

        <div className="payment-table-wrap">
          <table className="payment-table">
            <caption className="visually-hidden">Haruhay payment history</caption>
            <colgroup><col /><col /><col /><col /><col /></colgroup>
            <thead><tr><th>Billing period</th><th>Date paid</th><th>Method</th><th>Amount</th><th>Payment status</th></tr></thead>
            <tbody>
              {visiblePayments.map(payment => <tr key={payment.period}>
                <th scope="row" data-label="Billing period">{payment.period}</th>
                <td data-label="Date paid">{payment.date}</td>
                <td data-label="Method">{payment.method}</td>
                <td data-label="Amount">{payment.amount}</td>
                <td data-label="Payment status"><span className={`payment-status ${payment.status.toLowerCase()}`}>{payment.status}</span></td>
              </tr>)}
              {visiblePayments.length === 0 && <tr><td className="payment-empty" colSpan={5}>No pending payments are shown in this preview.</td></tr>}
            </tbody>
          </table>
        </div>

        <aside className="payment-security-note">
          <img src={asset('icon-shield.svg')} width="24" height="24" alt="" />
          <p>Payment records are stored securely and accessible only to authorized users.</p>
        </aside>
      </section>
    </div>
  </ResidentLayout>
}
