import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './Billing.css'
import ResidentDialog from './ResidentDialog'
import { payments } from './residentData'
import { downloadCsv } from './previewStore'

const asset = (name: string) => `./assets/dashboard/${name}`

type PaymentStatus = 'Paid' | 'Pending'
type PaymentFilter = 'All transactions' | PaymentStatus


const filters: PaymentFilter[] = ['All transactions', 'Paid', 'Pending']


export default function PaymentHistory() {
  const [filter, setFilter] = useState<PaymentFilter>('All transactions')
  const [notice, setNotice] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    document.title = 'Payment history | Haruhay'
  }, [])

  const visiblePayments = useMemo(() => payments.filter(payment => (
    filter === 'All transactions' || payment.status === filter
  )), [filter])

  function exportReceipts() {
    const chosen = visiblePayments.filter(payment => selected.includes(payment.period))
    if (!chosen.length) return
    const rows = [
      ['Billing period', 'Date paid', 'Method', 'Amount', 'Payment status'],
      ...chosen.map(payment => [payment.period, payment.date, payment.method, payment.amount, payment.status]),
    ]
    downloadCsv('haruhay-payment-history.csv', rows)
    setExportOpen(false)
    setNotice(`Exported ${chosen.length} payment records as CSV.`)
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
          <button className="payment-export" type="button" onClick={() => { setSelected(visiblePayments.map(payment => payment.period)); setExportOpen(true) }} disabled={visiblePayments.length === 0}>Export receipts</button>
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
          <p>Sample records for this local preview. Real payment records require authorized account access.</p>
        </aside>
      </section>
      <p className="resident-preview-label">Sample payment history · exports contain CSV records, not official receipt documents.</p>
    </div>
    {exportOpen && <ResidentDialog title="Export receipts" eyebrow="PAYMENT HISTORY" onClose={() => setExportOpen(false)}>
      <div className="dialog-body">
        <p>Select the payment records you want to export. Format: CSV spreadsheet.</p>
        <label className="dialog-choice"><input type="checkbox" checked={selected.length === visiblePayments.length} onChange={event => setSelected(event.target.checked ? visiblePayments.map(payment => payment.period) : [])} />Select all records</label>
        <fieldset><legend>Payment records</legend>{visiblePayments.map(payment => <label className="dialog-choice" key={payment.period}><input type="checkbox" checked={selected.includes(payment.period)} onChange={event => setSelected(previous => event.target.checked ? [...previous, payment.period] : previous.filter(period => period !== payment.period))} />{payment.period} · {payment.amount}</label>)}</fieldset>
        <p role="status">{selected.length} selected. This download is not an official receipt.</p>
      </div>
      <button className="dialog-primary" type="button" onClick={exportReceipts} disabled={!selected.length}>Download selected CSV</button>
    </ResidentDialog>}
  </ResidentLayout>
}
