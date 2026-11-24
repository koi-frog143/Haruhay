import { useState } from 'react'
import ResidentLayout from './ResidentLayout'
import { AdminStatus, AdminTable } from './AdminUI'
import ResidentDialog from './ResidentDialog'
import ReportPaymentDialog from './ReportPaymentDialog'
import { downloadCsv, usePreviewData } from './previewStore'
import { getWorkspaceSession, refreshPaymentRecords } from './workspaceSession'
import { money, periodLabel } from './billingData'
import { paymentDateLabel, paymentMethod, paymentStatus, proofLink, receiptLink, receiptNumber } from './paymentApi'
import type { Payment } from './paymentApi'

export default function LivePaymentHistory() {
  const workspace = usePreviewData(getWorkspaceSession)
  const records = workspace?.payments ?? []
  const [filter, setFilter] = useState<Payment['status'] | ''>('')
  const [notice, setNotice] = useState('')
  const [correction, setCorrection] = useState<Payment>()
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const visible = records.filter(payment => !filter || payment.status === filter)
  const correctionBill = workspace?.bills.find(bill => bill.id === correction?.bill_id)
  async function refresh() {
    setBusy(true)
    try { await refreshPaymentRecords() }
    catch { /* The workspace exposes the refresh error. */ }
    finally { setBusy(false) }
  }
  return <ResidentLayout activeSection="Payments" breadcrumb="Payment history" notice={notice} onNotice={setNotice} onDismissNotice={() => setNotice('')}>
    <div className="resident-content billing-content payment-history-content payment-live-section">
      <header className="resident-page-heading"><span>BILLING RECORDS</span><h1>Payment history</h1><p>Track reported payments and open verified receipts.</p></header>
      <div className="payment-history-toolbar">
        <div className="payment-filters" aria-label="Filter payment history">
          <button type="button" className={filter === '' ? 'active' : ''} aria-pressed={filter === ''} onClick={() => setFilter('')}>All transactions</button>
          {(Object.entries(paymentStatus) as [Payment['status'], string][]).map(([status, label]) => <button key={status} className={filter === status ? 'active' : ''} aria-pressed={filter === status} onClick={() => setFilter(status)}>{label}</button>)}
        </div>
        <div className="payment-live-actions"><button className="admin-secondary" disabled={busy} onClick={() => void refresh()}>Refresh payments</button>
          <button className="admin-secondary" disabled={!visible.length} onClick={() => setSelected(visible.map(payment => payment.id))}>Export CSV</button></div>
      </div>
      {workspace?.paymentError && <p className="ux-status" data-tone="error" role="alert">{workspace.paymentError}</p>}
      <AdminTable columns={['Billing period', 'Date paid', 'Method', 'Amount', 'Payment status']} rows={visible.map(payment => ({
        key: payment.id, cells: [
          <div>{periodLabel(payment.period)}<br /><small>{payment.property_name}</small></div>,
          paymentDateLabel(payment.payment_date),
          <div>{paymentMethod[payment.method]}<br /><small>{payment.reference}</small></div>, money(payment.amount),
          <div className="payment-state-stack">
            <AdminStatus>{paymentStatus[payment.status]}</AdminStatus>
            {payment.decline_reason && <small>Owner’s reason · {payment.decline_reason}</small>}
            {payment.reversal_reason && <small>Reversal reason · {payment.reversal_reason}</small>}
            {payment.has_proof && <a href={proofLink('resident', payment.id)} target="_blank" rel="noreferrer">View proof</a>}
            {payment.receipt_number != null && <a href={receiptLink(payment.id)}>Receipt {receiptNumber(payment.receipt_number)}</a>}
            {payment.status === 'DECLINED' && !payment.has_correction && workspace?.bills.some(bill => bill.id === payment.bill_id && bill.balance > 0)
              && <button className="admin-secondary" onClick={() => setCorrection(payment)}>Submit corrected details</button>}
            {payment.corrects_id && <small>Correction to an earlier submission</small>}
          </div>,
        ],
      }))} empty="No payments match this view." />
      <aside className="payment-security-note"><img src="./assets/dashboard/icon-shield.svg" width="24" height="24" alt="" /><p>Payment proof and receipts are available only to authorized accounts.</p></aside>
    </div>
    {correction && correctionBill && <ReportPaymentDialog bill={correctionBill} correction={correction} onClose={() => setCorrection(undefined)} onSaved={refresh} />}
    {selected && <ResidentDialog title="Export payment records" footerNote="" protectEdits={false} onClose={() => setSelected(null)}>
      <div className="dialog-body"><p>Select the records to include in the CSV.</p>
        <label className="dialog-choice"><input type="checkbox" checked={selected.length === visible.length} onChange={event => setSelected(event.target.checked ? visible.map(payment => payment.id) : [])} />Select all records</label>
        <fieldset><legend>Payment records</legend>{visible.map(payment => <label className="dialog-choice" key={payment.id}>
          <input type="checkbox" checked={selected.includes(payment.id)} onChange={event => setSelected(existing => event.target.checked ? [...(existing ?? []), payment.id] : (existing ?? []).filter(id => id !== payment.id))} />{periodLabel(payment.period)} · {money(payment.amount)} · {paymentStatus[payment.status]}
        </label>)}</fieldset>
      </div>
      <button className="dialog-primary" disabled={!selected.length} onClick={() => {
        downloadCsv('haruhay-payment-history.csv', [['Bill', 'Property', 'Payment date', 'Method', 'Amount (PHP)', 'Reference', 'Status', 'Receipt'],
          ...visible.filter(payment => selected.includes(payment.id)).map(payment => [payment.period, payment.property_name, payment.payment_date, paymentMethod[payment.method], String(payment.amount), payment.reference, paymentStatus[payment.status], payment.receipt_number == null ? '' : receiptNumber(payment.receipt_number)])])
        setSelected(null); setNotice('Payment records exported as CSV.')
      }}>Download selected CSV</button>
    </ResidentDialog>}
  </ResidentLayout>
}
