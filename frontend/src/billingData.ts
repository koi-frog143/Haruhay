import { getWorkspaceSession, isLiveWorkspace } from './workspaceSession'
import { readPreview, savePreview, manilaInputDate } from './previewStore'
import { CURRENT_RESIDENT_ID, getResidents } from './residentsData'
import { getSettings } from './settingsData'
import { paymentMethod } from './paymentApi'

export const money = (amount: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(amount)
export type LedgerPayment = { id: string; residentId: string; period: string; date: string; method: string; amount: number; reference: string; evidence: string; status: 'Needs review' | 'Approved' | 'Rejected' | 'Reversed'; reviewNote: string; reviewedAt: string }
function defaults(): LedgerPayment[] {
  const history = ['09', '08', '07', '06', '05'].map((month, index): LedgerPayment => ({ id: `pay-history-${month}`, residentId: CURRENT_RESIDENT_ID, period: `2026-${month}`, date: `2026-${month}-${['14', '13', '15', '12', '15'][index]}`, method: index === 2 || index === 4 ? 'Bank transfer' : 'GCash', amount: 3500, reference: `SAMPLE-PAID-${month}`, evidence: 'Sample historical payment record; no uploaded evidence.', status: 'Approved', reviewNote: 'Historical sample record', reviewedAt: `2026-${month}-16` }))
  return [...history,
    { id: 'pay-oct-andrea', residentId: CURRENT_RESIDENT_ID, period: '2026-10', date: '2026-10-12', method: 'GCash', amount: 3500, reference: 'SAMPLE-GC-102048', evidence: 'Sample evidence: GCash reference SAMPLE-GC-102048, amount ₱3,500.00, submitted October 12. No real payment document is attached.', status: 'Needs review', reviewNote: '', reviewedAt: '' },
    { id: 'pay-oct-luis', residentId: 'RES-0047', period: '2026-10', date: '2026-10-12', method: 'Bank transfer', amount: 3000, reference: 'SAMPLE-BT-102047', evidence: 'Sample bank-transfer declaration. Amount is lower than the standard bill; verify before approval.', status: 'Needs review', reviewNote: '', reviewedAt: '' },
    { id: 'pay-oct-sofia', residentId: 'RES-0046', period: '2026-10', date: '2026-10-11', method: 'GCash', amount: 3500, reference: 'SAMPLE-GC-102046', evidence: 'Sample GCash transaction declaration; no real receipt image is attached.', status: 'Needs review', reviewNote: '', reviewedAt: '' },
    { id: 'pay-sep-kevin', residentId: 'RES-0045', period: '2026-09', date: '2026-09-15', method: 'Bank transfer', amount: 3000, reference: 'SAMPLE-BT-092045', evidence: 'Historical sample record.', status: 'Approved', reviewNote: 'Historical approval', reviewedAt: '2026-09-16' },
  ]
}
function valid(value: unknown): value is LedgerPayment[] { return Array.isArray(value) && value.every(row => row && ['id', 'residentId', 'period', 'date', 'method', 'reference', 'evidence', 'reviewNote', 'reviewedAt'].every(key => typeof row[key] === 'string') && /^\d{4}-\d{2}$/u.test(row.period) && Number.isFinite(row.amount) && row.amount > 0 && ['Needs review', 'Approved', 'Rejected'].includes(row.status)) }
export function getLedgerPayments(): LedgerPayment[] {
  if (!isLiveWorkspace()) return readPreview('haruhay-payment-ledger', defaults(), valid)
  const workspace = getWorkspaceSession()
  return (workspace?.payments ?? []).map(payment => ({
    id: payment.id, residentId: workspace?.account.role === 'OWNER' ? payment.application_id : CURRENT_RESIDENT_ID,
    period: payment.period, date: payment.payment_date, method: paymentMethod[payment.method], amount: payment.amount,
    reference: payment.reference, evidence: payment.has_proof ? 'Private proof attached' : '',
    status: ({ PENDING: 'Needs review', APPROVED: 'Approved', DECLINED: 'Rejected', REVERSED: 'Reversed' } as const)[payment.status],
    reviewNote: payment.decline_reason || payment.reversal_reason || '', reviewedAt: payment.verified_at || '',
  }))
}
export const periodLabel = (period: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' }).format(new Date(`${period}-01T00:00:00+08:00`))
export function reviewPayment(id: string, status: 'Approved' | 'Rejected', note: string, verified: boolean) {
  const rows = getLedgerPayments()
  const payment = rows.find(row => row.id === id)
  if (!payment || payment.status !== 'Needs review') throw new Error('This payment is no longer awaiting review.')
  if (!verified) throw new Error('Confirm that you checked the resident, amount, reference and sample evidence.')
  if (status === 'Rejected' && !note.trim()) throw new Error('Enter a reason before rejecting this submission.')
  if (status === 'Approved' && rows.some(row => row.id !== id && row.status === 'Approved' && row.reference === payment.reference)) throw new Error('An approved record already uses this reference.')
  savePreview('haruhay-payment-ledger', rows.map(row => row.id === id ? { ...row, status, reviewNote: note.trim(), reviewedAt: manilaInputDate() } : row))
}
export function getBillingSummary(residentId = CURRENT_RESIDENT_ID) {
  if(isLiveWorkspace())return liveBill(residentId)
  const rules = getSettings().billing
  const total = rules.rent + rules.utilities
  const paid = getLedgerPayments().filter(payment => payment.residentId === residentId && payment.period === rules.period && payment.status === 'Approved').reduce((sum, payment) => sum + payment.amount, 0)
  const due = `${rules.period}-${String(rules.dueDay).padStart(2, '0')}`
  const dueLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric' }).format(new Date(`${due}T00:00:00+08:00`))
  const days = Math.round((Date.parse(due + 'T00:00:00+08:00') - Date.parse(manilaInputDate().slice(0, 10) + 'T00:00:00+08:00')) / 86400000)
  return { period: periodLabel(rules.period), periodKey: rules.period, due, dueLabel: isLiveWorkspace() && total === 0 ? 'No bill issued' : dueLabel, rent: rules.rent, utilities: rules.utilities, outstanding: 0, total, paid, credit: Math.max(0, paid - total), balance: Math.max(0, total - paid), posted:true,agreedMonthly:total,hasAgreement:true,variableCharges:false,timing: isLiveWorkspace() && total === 0 ? 'No payment scheduled' : days < 0 ? `${-days} days past sample due date` : days === 0 ? 'Due today' : `${days} days remaining` }
}
function liveBill(residentId:string){
  const session=getWorkspaceSession()
  const owner=session?.account.role==='OWNER'
  const app=session?.applications.find(a=>a.status==='APPROVED'&&(owner?a.id===residentId:a.email===session.account.email))
  const terms=app?.offers?.[0]?.terms
  const rent=terms?.applicant_monthly_rent==null?0:Number(terms.applicant_monthly_rent)
  const fixed=(terms?.charges||[]).filter(c=>c.basis==='FIXED_MONTHLY').reduce((sum,c)=>sum+Number(c.amount||0),0)
  const bills=(session?.bills||[]).filter(b=>!owner||b.application_id===app?.id).sort((a,b)=>a.due_date.localeCompare(b.due_date))
  const bill=bills.find(b=>Number(b.balance)>0) ?? bills.at(-1)
  const period=bill?.period||manilaInputDate().slice(0,7)
  const total=bill?Number(owner?bill.application_total:bill.account_total):0
  const paid=bill?Number(owner?bill.application_paid:bill.account_paid):0
  const balance=bill?Number(owner?bill.application_balance:bill.account_balance):0
  const outstanding=bill?Math.max(0,balance-Number(bill.balance)):0
  const due=bill?.due_date||''
  const days=bill?Math.round((Date.parse(due+'T00:00:00+08:00')-Date.parse(manilaInputDate().slice(0,10)+'T00:00:00+08:00'))/86400000):0
  return {period:periodLabel(period),periodKey:period,due,dueLabel:bill?new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',month:'long',day:'numeric'}).format(new Date(due+'T00:00:00+08:00')):'No bill posted',rent:bill?Number(bill.rent):rent,utilities:bill?Number(bill.fixed_charges):fixed,outstanding,total,paid,credit:0,balance,timing:bill?(balance===0?'All posted bills paid':days<0?(-days)+' days overdue':days===0?'Due today':days+' days remaining'):'Awaiting a posted bill',posted:Boolean(bill),agreedMonthly:rent+fixed,hasAgreement:Boolean(terms),variableCharges:(terms?.charges||[]).some(c=>['USAGE_BASED','TO_CONFIRM'].includes(c.basis))}
}
export function getResidentPayments() {
  return getLedgerPayments().filter(payment => payment.residentId === CURRENT_RESIDENT_ID).map(payment => ({ id: payment.id, period: periodLabel(payment.period), date: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(payment.date + 'T00:00:00+08:00')), method: payment.method, amount: money(payment.amount), status: payment.status === 'Approved' ? 'Paid' : payment.status === 'Rejected' ? 'Rejected' : payment.status === 'Reversed' ? 'Reversed' : 'Pending', reviewNote: payment.reviewNote }))
}
export function getPropertyBilling() {
  const live = isLiveWorkspace()
  const collections = live ? getWorkspaceSession()?.collections : null
  const period = live ? collections?.period ?? manilaInputDate().slice(0,7) : getSettings().billing.period
  const ledger = getLedgerPayments()
  const balances = getResidents().filter(resident => resident.status === 'Active').map(resident => ({ resident, ...getBillingSummary(resident.id) }))
  const collected = (month: string) => live ? Number(collections?.months[month] ?? 0)
    : ledger.filter(payment => payment.period === month && payment.status === 'Approved').reduce((sum, payment) => sum + payment.amount, 0)
  return {
    period, balances, collected: collected(period), pending: ledger.filter(payment => payment.status === 'Needs review'),
    outstanding: live ? Number(collections?.outstanding ?? 0) : balances.reduce((sum, bill) => sum + bill.balance, 0),
    monthly: Array.from({ length: Number(period.slice(5, 7)) }, (_, index) => {
      const month = `${period.slice(0,4)}-${String(index+1).padStart(2,'0')}`
      return { label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Manila' }).format(new Date(month + '-01T00:00:00+08:00')), amount: collected(month) }
    }),
  }
}
