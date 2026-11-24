import { useState } from 'react'
import { AdminStatus, AdminTable } from './AdminUI'
import ReportPaymentDialog from './ReportPaymentDialog'
import { usePreviewData } from './previewStore'
import { getWorkspaceSession, refreshPaymentRecords } from './workspaceSession'
import type { MonthlyBill } from './workspaceSession'
import { money, periodLabel } from './billingData'
import { billStatus, paymentDateLabel } from './paymentApi'

export default function PostedBills({ onNotice }: { onNotice: (message: string) => void }) {
  const workspace = usePreviewData(getWorkspaceSession)
  const [selected, setSelected] = useState<MonthlyBill>()
  const bills = workspace?.bills ?? []
  return <section className="payment-live-section" aria-labelledby="posted-bills">
    <h2 id="posted-bills">Posted bills</h2>
    {workspace?.paymentError && <p className="ux-status" data-tone="error" role="alert">{workspace.paymentError}</p>}
    <AdminTable columns={['Billing month', 'Due date', 'Bill amount', 'Remaining', 'Status', 'Action']} rows={bills.map(bill => {
      const waiting = (workspace?.payments ?? []).filter(payment => payment.bill_id === bill.id && payment.status === 'PENDING').length
      return { key: bill.id, cells: [
        <div>{periodLabel(bill.period)}<br /><small>{bill.property_name} · {bill.room_label}</small></div>,
        paymentDateLabel(bill.due_date), money(bill.total), money(bill.balance),
        <div className="payment-state-stack"><AdminStatus>{billStatus[bill.bill_status]}</AdminStatus>
          {waiting > 0 && <a href="#/resident/payments/history">{waiting} waiting for verification</a>}</div>,
        bill.balance > 0 ? <button className="admin-secondary" onClick={() => setSelected(bill)}>Report a payment</button> : <a href="#/resident/payments/history">View history</a>,
      ] }
    })} empty={workspace?.paymentError ? 'Posted bills could not be loaded.' : 'No bills have been posted yet.'} />
    {selected && <ReportPaymentDialog bill={selected} onClose={() => setSelected(undefined)} onSaved={async () => {
      try { await refreshPaymentRecords(); onNotice('Payment report saved.') }
      catch { onNotice('Payment report saved. Refresh billing to see the latest records.') }
    }} />}
  </section>
}
