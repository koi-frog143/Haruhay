import { api } from './registrationApi'
export type VisitorRecord = { id:string; property_id:string; tenancy_id:string; full_name:string; contact:string; purpose:string; arrival:string; departure:string; status:string; reason:string|null; host_name:string;host_application_id:string; room_label:string; visit_id:string|null; visit_status:string|null; checked_in:string|null; checked_out:string|null; voided:boolean|null }
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
export function localInput(value:string){return new Date(value+':00+08:00').toISOString()}
export const visitLabel=(r:VisitorRecord)=>r.voided?'Voided':(r.visit_status||r.status).toLowerCase().replaceAll('_',' ').replace(/^./,s=>s.toUpperCase())
