export type MonthlyBill={id:string;application_id:string;period:string;due_date:string;rent:number;fixed_charges:number}
import { api } from './registrationApi'
import type { Account, Admission, Property, Room } from './registrationApi'

export type WorkspaceSession = { account: Account; applications: Admission[]; properties: Property[]; rooms: Room[]; bills:MonthlyBill[] }
let session: WorkspaceSession | null = null
let sampleMode = false
export function isSampleWorkspace() {
  try { sampleMode = sessionStorage.getItem('haruhay-ui-mode') === 'sample' } catch { /* Keep the current mode if storage is unavailable. */ }
  return sampleMode
}
export function isLiveWorkspace() { return !isSampleWorkspace() }
export function getWorkspaceSession() { return isLiveWorkspace() ? session : null }
export function workspaceStorageKey(key: string) { return isSampleWorkspace() ? key : 'haruhay-live-ui-v1:' + (session?.account.id || 'guest') + ':' + key }
export function setWorkspaceMode(mode: 'live' | 'sample') {
  sampleMode = mode === 'sample'
  try { sessionStorage.setItem('haruhay-ui-mode', mode) } catch { /* Backend login still works without browser-local storage. */ }
  if (mode === 'sample') session = null
  window.dispatchEvent(new Event('haruhay-workspace-changed'))
}
export async function loadWorkspaceSession(account?: Account) {
  const identity = account || await api<Account>('/account')
  const owner = identity.role === 'OWNER'
  const [applications, properties, rooms] = await Promise.all([
    api<Admission[]>(owner ? '/owner/admissions' : '/account/admissions'),
    owner ? api<Property[]>('/owner/properties') : Promise.resolve([]),
    owner ? api<Room[]>('/owner/rooms') : Promise.resolve([]),
  ])
  const bills=owner?await api<MonthlyBill[]>('/owner/bills'):applications.some(a=>a.status==='APPROVED')?await api<MonthlyBill[]>('/resident/bills'):[]
  session = { account: identity, applications, properties, rooms, bills }
  setWorkspaceMode('live')
  return session
}
export async function signOutWorkspace() {
  await api('/auth/logout', {})
  session = null
  setWorkspaceMode('live')
  window.location.hash = '/login'
  window.location.reload()
}
export function workspaceResident() {
  const account = session?.account
  const stay = session?.applications.find(a => a.status === 'APPROVED' && a.email === account?.email)
  return { id: 'RES-0204', fullName: account?.full_name || '', email: account?.email || '', mobile: account?.contact || '',
    room: stay?.room_label || '', moveIn: stay?.reviewed_at?.slice(0, 10) || '', status: stay ? 'Active' as const : 'Inactive' as const,
    verified: account?.email_verified || false, paymentReminders: true, maintenanceUpdates: true, communityAnnouncements: true }
}
export function workspaceResidents() {
  if (!session) return []
  if (session.account.role !== 'OWNER') return session.applications.some(a => a.status === 'APPROVED') ? [workspaceResident()] : []
  return session.applications.filter(a => a.status === 'APPROVED').map(a => ({
    ...workspaceResident(), id: a.id, fullName: a.full_name, email: a.email, mobile: a.contact,
    room: a.room_label || '', moveIn: a.reviewed_at?.slice(0, 10) || '', status: 'Active' as const, verified: a.email_verified,
  }))
}
export function liveFallback<T>(key: string, fallback: T): T {
  if (!isLiveWorkspace()) return fallback
  let value: unknown = fallback
  if (key === 'haruhay-residents-v1') value = workspaceResidents()
  else if (key === 'haruhay-visitors-v1') value = { requests: [], visits: [] }
  else if (key === 'haruhay-property-settings') {
    const settings = fallback as Record<string, unknown>
    value = { ...settings,
      property: { name: session?.properties[0]?.name || session?.applications[0]?.property_name || '', contact: session?.account.role === 'OWNER' ? session.account.contact : '', rooms: session?.rooms.map(r => r.label) || [], amenities: '', rules: '' },
      billing: { period: new Date().toISOString().slice(0, 7), rent: 0, utilities: 0, dueDay: 1, graceDays: 0 },
      staff: session?.account.role === 'OWNER' ? [{ id: session.account.id, name: session.account.full_name, role: 'Administrator', active: true, permissions: ['Residents', 'Visitors', 'Maintenance', 'Holding station', 'Billing', 'Announcements', 'Settings'] }] : [],
    }
  } else if (Array.isArray(fallback)) value = []
  return value as T
}
