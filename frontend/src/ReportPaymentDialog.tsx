import { useState } from 'react'
import type { FormEvent } from 'react'
import ResidentDialog from './ResidentDialog'
import { api } from './registrationApi'
import { money, periodLabel } from './billingData'
import { paymentDateLabel, paymentMethod, paymentPath, uploadPaymentProof } from './paymentApi'
import type { Payment } from './paymentApi'
import { philippineToday } from './visitorApi'
import type { MonthlyBill } from './workspaceSession'

export default function ReportPaymentDialog({ bill, correction, onClose, onSaved }: {
  bill: MonthlyBill; correction?: Payment; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [requestKey] = useState(() => crypto.randomUUID())
  const [saved, setSaved] = useState('')
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  const [proofError, setProofError] = useState('')
  const [busy, setBusy] = useState(false)
  async function upload(id: string) {
    if (!file) return
    setProofError('')
    try { await uploadPaymentProof(id, file); setFile(undefined) }
    catch (error) { setProofError(error instanceof Error ? error.message : 'Upload failed. Try again.') }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || saved) return
    setBusy(true)
    setError('')
    const fields = new FormData(event.currentTarget)
    try {
      const result = await api<{ id: string }>(paymentPath('resident'), {
        billId: bill.id, requestKey, correctsId: correction?.id,
        amount: fields.get('amount'), method: fields.get('method'), paymentDate: fields.get('date'), reference: fields.get('reference'),
      })
      setSaved(result.id)
      await upload(result.id)
      await onSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the payment report.')
    } finally {
      setBusy(false)
    }
  }
  return <ResidentDialog title={correction ? 'Submit corrected details' : 'Report a payment'} footerNote="" busy={busy} onClose={onClose} preserveDraftOnClose={!!saved}>
    <p className="payment-context"><strong>{periodLabel(bill.period)} · {bill.property_name}</strong><br />Due {paymentDateLabel(bill.due_date)} · {money(bill.balance)} remaining</p>
    {saved ? <div className="admin-form payment-live-form">
      <p role="status"><strong>Waiting for verification</strong><br />Your payment report is saved. The balance updates after owner approval.</p>
      {proofError && <><p className="ux-status" data-tone="error" role="alert">Your report is saved. {proofError}</p>
        <label>Choose another proof image<input type="file" accept="image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0])} /></label>
        <button type="button" className="admin-secondary" disabled={!file || busy} onClick={async () => {
          setBusy(true); await upload(saved); await onSaved(); setBusy(false)
        }}>Retry proof upload</button></>}
      <a className="admin-primary" href="#/resident/payments/history" onClick={onClose}>View payment history</a>
    </div> : <form className="admin-form payment-live-form" onSubmit={submit}>
      {correction?.decline_reason && <p className="ux-status" data-tone="warning">Owner’s reason · {correction.decline_reason}</p>}
      <p>Enter the details of a payment you already made.</p>
      <div className="payment-form-grid">
        <label>Amount paid (PHP)<input name="amount" required type="number" min="0.01" max={bill.balance} step="0.01" defaultValue={Math.min(correction?.amount ?? bill.balance, bill.balance).toFixed(2)} /></label>
        <label>Payment method<select name="method" required defaultValue={correction?.method || ''}><option value="" disabled>Choose a method</option>{Object.entries(paymentMethod).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label>Payment date<input name="date" type="date" required max={philippineToday()} defaultValue={correction?.payment_date || philippineToday()} /></label>
        <label>Transaction or front desk reference<input name="reference" required maxLength={120} defaultValue={correction?.reference} /></label>
      </div>
      <label>Payment proof (optional)<input type="file" accept="image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0])} /><small>Private JPEG or PNG, up to 5 MB.</small></label>
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      <button className="admin-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit payment report'}</button>
    </form>}
  </ResidentDialog>
}
