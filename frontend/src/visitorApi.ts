import { api } from './registrationApi'
export const visitLabels = {
  PENDING: 'Waiting for approval', EXPECTED: 'Ready to visit', CHECKED_IN: 'Inside', CHECKED_OUT: 'Left',
  DECLINED: 'Declined', CANCELLED: 'Cancelled', EXPIRED: 'Expired', VOIDED: 'Voided',
}
export type VisitState = keyof typeof visitLabels
export type VisitorRecord = { id:string; property_id:string; tenancy_id:string; full_name:string; contact:string; purpose:string; arrival:string|null; departure:string|null; planned_date:string|null; window_policy:'LEGACY'|'FLEXIBLE'; display_status:VisitState; status:string; reason:string|null; host_name:string;host_application_id:string; room_label:string; visit_id:string|null; visit_status:string|null; checked_in:string|null; checked_out:string|null; voided:boolean|null; has_shareable_pass:boolean }
export type GuestPass = { token:string; startsAt:string; expiresAt:string; propertyName:string; entryWindowEnded:boolean }
export type SharedPass = GuestPass & { shareToken:string; visitId:string }
export type Host = { id:string;full_name:string;label:string;property_name:string;property_id:string }
export type LogProperty={id:string;name:string;can_review:boolean}
let snapshot:VisitorRecord[]=[]
let generation=0
let identity:string|null=null
export function liveVisitorRecords(){return snapshot}
export function clearVisitorRecords(){generation++;snapshot=[]}
// Also invalidate module instances held by in-flight requests during Vite hot reload/account navigation.
if(typeof window!=='undefined'){
  const changed=(event:Event)=>{identity=(event as CustomEvent<{accountId:string|null}>).detail?.accountId||null;clearVisitorRecords()}
  window.addEventListener('haruhay-workspace-changed',changed)
  import.meta.hot?.dispose(()=>window.removeEventListener('haruhay-workspace-changed',changed))
}
export async function loadVisitorRecords(property?:string){
  const account=identity, version=++generation
  const data=await api<VisitorRecord[]>('/logbook/records'+(property?'?property='+encodeURIComponent(property):''))
  if(account!==identity||version!==generation)return null
  snapshot=data;window.dispatchEvent(new Event('haruhay-preview-updated'));return data
}
export function philippineTime(value:string|null){return value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not recorded'}
export function philippineDate(value:string){
  return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'}).format(new Date(value+'T00:00:00+08:00'))
}
export function philippineToday(){
  const parts=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts()
  return ['year','month','day'].map(field=>parts.find(part=>part.type===field)?.value).join('-')
}
export const visitLabel=(r:VisitorRecord)=>visitLabels[r.display_status]
