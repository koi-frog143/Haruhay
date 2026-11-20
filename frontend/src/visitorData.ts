import { readPreview, savePreview, manilaInputDate } from './previewStore'
import { CURRENT_RESIDENT_ID, getResident } from './residentsData'

export type VisitorRequest = { id: string; fullName: string; contactNumber: string; purpose: string; expectedArrival: string; status: 'Pending review' | 'Cancelled' | 'Registered' | 'Declined' }
export type Visit = { id: string; residentId: string; fullName: string; contactNumber: string; purpose: string; arrival: string; status: 'Expected' | 'Checked in' | 'Checked out'; checkedIn: string; checkedOut: string; requestId: string }
type VisitorState = { requests: VisitorRequest[]; visits: Visit[] }
function isRequest(value: unknown): value is VisitorRequest {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return ['id', 'fullName', 'contactNumber', 'purpose', 'expectedArrival'].every(key => typeof row[key] === 'string') && ['Pending review', 'Cancelled', 'Registered', 'Declined'].includes(String(row.status)) && Number.isFinite(Date.parse(String(row.expectedArrival)))
}
function isVisit(value: unknown): value is Visit {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return ['id', 'residentId', 'fullName', 'contactNumber', 'purpose', 'arrival', 'checkedIn', 'checkedOut', 'requestId'].every(key => typeof row[key] === 'string') && ['Expected', 'Checked in', 'Checked out'].includes(String(row.status))
}
function seed(): VisitorState {
  const legacy = readPreview<unknown[]>('haruhay-visitor-requests', [], (value): value is unknown[] => Array.isArray(value))
  const requests = legacy.map((row, index) => row && typeof row === 'object' ? { id: `legacy-${index}`, status: 'Pending review', ...row } : null).filter(isRequest)
  return { requests, visits: [
    { id: 'visit-maria', residentId: CURRENT_RESIDENT_ID, fullName: 'Maria Santos', contactNumber: '09171230001', purpose: 'Personal', arrival: '2026-10-08T10:32', checkedIn: '2026-10-08T10:32', checkedOut: '', status: 'Checked in', requestId: '' },
    { id: 'visit-john', residentId: CURRENT_RESIDENT_ID, fullName: 'John Mercado', contactNumber: '09171230002', purpose: 'Personal', arrival: '2026-10-07T16:45', checkedIn: '2026-10-07T16:45', checkedOut: '2026-10-07T18:00', status: 'Checked out', requestId: '' },
    { id: 'visit-peter', residentId: 'RES-0046', fullName: 'Peter Cruz', contactNumber: '09171230003', purpose: 'Delivery', arrival: '2026-10-12T09:15', checkedIn: '2026-10-12T09:15', checkedOut: '', status: 'Checked in', requestId: '' },
    { id: 'visit-jane', residentId: 'RES-0045', fullName: 'Jane Rivera', contactNumber: '09171230004', purpose: 'Personal', arrival: '2026-10-10T13:28', checkedIn: '2026-10-10T13:28', checkedOut: '2026-10-10T14:30', status: 'Checked out', requestId: '' },
  ] }
}
export function getVisitorState() { return readPreview('haruhay-visitors-v1', seed(), (value): value is VisitorState => !!value && typeof value === 'object' && Array.isArray((value as VisitorState).requests) && (value as VisitorState).requests.every(isRequest) && Array.isArray((value as VisitorState).visits) && (value as VisitorState).visits.every(isVisit)) }
export function getVisitorRequests() { return getVisitorState().requests }
export function getAllVisits() { return getVisitorState().visits }
export function getVisitorEntries() {
  return getAllVisits().filter(visit => visit.residentId === CURRENT_RESIDENT_ID && visit.status !== 'Expected').map(visit => ({ id: visit.id, person: visit.fullName, type: 'Guest', dateTime: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(visit.checkedIn + '+08:00')), isoDate: visit.checkedIn.slice(0, 10), location: `Room ${getResident(visit.residentId)?.room ?? 'Unassigned'}`, status: visit.status }))
}
export function createVisitorRequest(input: Omit<VisitorRequest, 'id' | 'status'>) {
  if (!input.fullName.trim() || !input.purpose.trim()) throw new Error('Enter a name and purpose for the visit.')
  if (!/^09\d{9}$/u.test(input.contactNumber.replace(/[\s-]/gu, ''))) throw new Error('Enter an 11-digit mobile number beginning with 09.')
  if (!Number.isFinite(Date.parse(input.expectedArrival)) || input.expectedArrival < manilaInputDate()) throw new Error('Choose an arrival time in the future (Philippine time).')
  const state = getVisitorState()
  if (state.requests.some(row => row.status === 'Pending review' && row.fullName.toLowerCase() === input.fullName.toLowerCase() && row.expectedArrival === input.expectedArrival)) throw new Error('A pending request already exists for this guest and arrival time.')
  savePreview('haruhay-visitors-v1', { ...state, requests: [{ ...input, id: crypto.randomUUID(), status: 'Pending review' }, ...state.requests] })
}
export function cancelVisitorRequest(id: string) { const state = getVisitorState(); if (!state.requests.some(row => row.id === id && row.status === 'Pending review')) throw new Error('Only a pending request can be cancelled.'); savePreview('haruhay-visitors-v1', { ...state, requests: state.requests.map(row => row.id === id ? { ...row, status: 'Cancelled' } : row) }) }
export function registerVisit(input: Pick<Visit, 'fullName' | 'contactNumber' | 'purpose' | 'residentId' | 'arrival'>, requestId = '') {
  const resident = getResident(input.residentId)
  if (!resident || resident.status !== 'Active') throw new Error('Choose an active host resident.')
  if (!input.fullName.trim() || !input.purpose.trim() || !/^09\d{9}$/u.test(input.contactNumber.replace(/[\s-]/gu, ''))) throw new Error('Enter the visitor name, purpose and a valid 11-digit mobile number beginning with 09.')
  if (!Number.isFinite(Date.parse(input.arrival))) throw new Error('Choose a valid expected arrival time.')
  const state = getVisitorState()
  if (requestId && !state.requests.some(request => request.id === requestId && request.status === 'Pending review')) throw new Error('This request is no longer pending review.')
  const visit: Visit = { ...input, id: crypto.randomUUID(), status: 'Expected', checkedIn: '', checkedOut: '', requestId }
  savePreview('haruhay-visitors-v1', { visits: [visit, ...state.visits], requests: state.requests.map(row => row.id === requestId ? { ...row, status: 'Registered' } : row) })
}
export function changeVisitStatus(id: string, status: 'Checked in' | 'Checked out') {
  const state = getVisitorState()
  const visit = state.visits.find(row => row.id === id)
  if (!visit || (status === 'Checked in' && visit.status !== 'Expected') || (status === 'Checked out' && visit.status !== 'Checked in')) throw new Error('This visitor cannot make that status change.')
  if (status === 'Checked in' && getResident(visit.residentId)?.status !== 'Active') throw new Error('The host resident is inactive. Check the resident record first.')
  const now = manilaInputDate()
  savePreview('haruhay-visitors-v1', { ...state, visits: state.visits.map(row => row.id === id ? { ...row, status, checkedIn: status === 'Checked in' ? now : row.checkedIn, checkedOut: status === 'Checked out' ? now : row.checkedOut } : row) })
}
