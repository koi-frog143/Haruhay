import { useState } from 'react'
import ResidentDialog from './ResidentDialog'
import { api } from './registrationApi'
import { getWorkspaceSession, loadWorkspaceSession } from './workspaceSession'
import { money } from './billingData'
import { manilaInputDate } from './previewStore'

export default function PostMonthlyBill({onClose,onSaved}:{onClose:()=>void;onSaved:(message:string)=>void}){
  const applications=getWorkspaceSession()?.applications.filter(a=>a.status==='APPROVED'&&a.offers?.[0]?.accepted_at)||[]
  const [id,setId]=useState(applications[0]?.id||''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const terms=applications.find(a=>a.id===id)?.offers?.[0]?.terms
  const monthly=terms?.applicant_monthly_rent
  const fixed=(terms?.charges||[]).filter(c=>c.basis==='FIXED_MONTHLY').reduce((sum,c)=>sum+Number(c.amount||0),0)
  return <ResidentDialog dismissOnBackdrop={false} title="Post monthly bill" eyebrow="BILLING & PAYMENTS" footerNote="Bills are saved to property records. Posting a bill does not record or process a payment." onClose={()=>{if(!busy)onClose()}}><form className="registration-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const data=new FormData(e.currentTarget);try{await api('/owner/bills',{applicationId:id,period:data.get('period'),dueDate:data.get('dueDate')});await loadWorkspaceSession();onSaved('Monthly bill is posted and visible to the resident. Existing bills are kept without duplication.')}catch(error){setError(error instanceof Error?error.message:'Could not post the bill.')}finally{setBusy(false)}}}>
    {!applications.length?<p>No approved residents with accepted room terms yet.</p>:<><label>Resident<select required value={id} onChange={e=>setId(e.target.value)}>{applications.map(a=><option value={a.id} key={a.id}>{a.full_name} / {a.offers?.[0]?.terms.label}</option>)}</select></label><div className="room-review-summary"><p>Accepted monthly rent: <strong>{monthly==null?'Not confirmed':money(Number(monthly))}</strong></p><p>Fixed monthly charges: <strong>{money(fixed)}</strong></p><p>Bill total: <strong>{monthly==null?'Not confirmed':money(Number(monthly)+fixed)}</strong></p><small>Metered and unconfirmed charges are excluded. Deposit and advance rent are not charged again. A posted bill keeps this accepted rate even if the listing changes later.</small></div><label>Billing month<input name="period" type="month" required defaultValue={manilaInputDate().slice(0,7)}/></label><label>Due date<input name="dueDate" type="date" required/></label><p>One bill per tenancy and month. Reposting keeps the existing bill and its original due date.</p></>}
    {error&&<p role="alert" className="form-error">{error}</p>}<button className="dialog-primary" disabled={busy||!id||monthly==null}>{busy?'Posting...':'Post bill'}</button>
  </form></ResidentDialog>
}
