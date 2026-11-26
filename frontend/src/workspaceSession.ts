export type MonthlyBill = {
  id: string; application_id: string; period: string; due_date: string; rent: number; fixed_charges: number
  total: number; paid: number; balance: number; bill_status: keyof typeof billStatus
  property_name: string; room_label: string
  application_balance: number; application_total: number; application_paid: number
  account_balance: number; account_total: number; account_paid: number
}
import { api } from './registrationApi'
import { clearVisitorRecords, loadVisitorRecords } from './visitorApi'
import { refreshMaintenance } from './maintenanceApi'
import type { Account, Admission, Property, Room } from './registrationApi'
import { paymentPath } from './paymentApi'
import type { billStatus, Collections, Payment } from './paymentApi'

export type WorkspaceSession = {
  account: Account; applications: Admission[]; properties: Property[]; rooms: Room[]; bills: MonthlyBill[]
  payments: Payment[]; collections: Collections | null; paymentError: string
}
let session: WorkspaceSession | null = null
let sampleMode = false
let sessionGeneration = 0
let billingGeneration = 0
export function isSampleWorkspace() {
  try { sampleMode = sessionStorage.getItem('haruhay-ui-mode') === 'sample' } catch { /* Keep the current mode if storage is unavailable. */ }
  return sampleMode
}
export function isLiveWorkspace() { return !isSampleWorkspace() }
export function getWorkspaceSession() { return isLiveWorkspace() ? session : null }
export function hasActiveStay(applications: Admission[]) { return applications.some(a => a.tenancy_status === 'ACTIVE') }
export function hasEndedStay(applications: Admission[]) { return applications.some(a => a.tenancy_status === 'ENDED') }
export function hasPendingApplication(applications: Admission[]) {
  return applications.some(a => ['AWAITING_EMAIL', 'PENDING_APPROVAL', 'CORRECTIONS_REQUESTED'].includes(a.status))
}
export function workspaceStorageKey(key: string) { return isSampleWorkspace() ? key : 'haruhay-live-ui-v1:' + (session?.account.id || 'guest') + ':' + key }
export function setWorkspaceMode(mode: 'live' | 'sample') {
  sampleMode = mode === 'sample'
  try { sessionStorage.setItem('haruhay-ui-mode', mode) } catch { /* Backend login still works without browser-local storage. */ }
  if (mode === 'sample') { sessionGeneration++; clearVisitorRecords(); session = null }
  window.dispatchEvent(new CustomEvent('haruhay-workspace-changed',{detail:{accountId:mode==='live'?session?.account.id||null:null}}))
}
export async function loadWorkspaceSession(account?: Account) {
  const version = ++sessionGeneration
  const identity = account || await api<Account>('/account')
  const owner = identity.role === 'OWNER'
  const staff = identity.role === 'GUARD' || identity.role === 'TECHNICIAN'
  const [applications, properties, rooms] = await Promise.all([
    staff ? Promise.resolve([]) : api<Admission[]>(owner ? '/owner/admissions' : '/account/admissions'),
    owner ? api<Property[]>('/owner/properties') : Promise.resolve([]),
    owner ? api<Room[]>('/owner/rooms') : Promise.resolve([]),
  ])
  const activeStay = hasActiveStay(applications)
  const hasBilling = owner || (!staff && (activeStay || hasEndedStay(applications)))
  const role = owner ? 'owner' : 'resident'
  const [billsResult, paymentsResult, collectionsResult] = await Promise.allSettled([
    hasBilling ? api<MonthlyBill[]>('/' + role + '/bills') : Promise.resolve([]),
    hasBilling ? api<Payment[]>(paymentPath(role)) : Promise.resolve([]),
    owner ? api<Collections>('/owner/payment-collections') : Promise.resolve(null),
  ])
  const next: WorkspaceSession = {
    account: identity, applications, properties, rooms,
    bills: billsResult.status === 'fulfilled' ? billsResult.value : [],
    payments: paymentsResult.status === 'fulfilled' ? paymentsResult.value : [],
    collections: collectionsResult.status === 'fulfilled' ? collectionsResult.value : null,
    paymentError: [billsResult, paymentsResult, collectionsResult].some(result => result.status === 'rejected')
      ? 'Some billing records could not be loaded. Refresh billing and try again.' : '',
  }
  if (version !== sessionGeneration) return next
  if (session?.account.id !== identity.id || (!activeStay && !owner && !staff)) clearVisitorRecords()
  session = next
  setWorkspaceMode('live')
  await Promise.all([
    owner || activeStay ? loadVisitorRecords().catch(() => null) : Promise.resolve(),
    owner || identity.role === 'TECHNICIAN' || activeStay ? refreshMaintenance() : Promise.resolve(),
  ])
  if (version === sessionGeneration) window.dispatchEvent(new Event('haruhay-preview-updated'))
  return session
}
export async function refreshPaymentRecords() {
  const workspace = getWorkspaceSession()
  if (!workspace) return
  const version = sessionGeneration
  const request = ++billingGeneration
  const role = workspace.account.role === 'OWNER' ? 'owner' : 'resident'
  try {
    const [bills, payments, collections] = await Promise.all([
      api<MonthlyBill[]>('/' + role + '/bills'),
      api<Payment[]>(paymentPath(role)),
      role === 'owner' ? api<Collections>('/owner/payment-collections') : Promise.resolve(null),
    ])
    if (version === sessionGeneration && request === billingGeneration && session?.account.id === workspace.account.id) {
      session = { ...session, bills, payments, collections, paymentError: '' }
      window.dispatchEvent(new Event('haruhay-preview-updated'))
    }
  } catch (error) {
    if (version === sessionGeneration && request === billingGeneration && session?.account.id === workspace.account.id) {
      session = { ...session, paymentError: 'Some billing records could not be refreshed. Try again.' }
      window.dispatchEvent(new Event('haruhay-preview-updated'))
    }
    throw error
  }
}
export async function signOutWorkspace() {
  await api('/auth/logout', {})
  clearWorkspaceSession()
  window.location.hash = '/login'
  window.location.reload()
}
export function clearWorkspaceSession() {
  sessionGeneration++
  clearVisitorRecords()
  session = null
  setWorkspaceMode('live')
}
export function workspaceResident() {
  const account = session?.account
  const stay = session?.applications.find(a => a.tenancy_status === 'ACTIVE') ?? session?.applications.find(a => a.tenancy_status === 'ENDED')
  return { id: 'RES-0204', fullName: account?.full_name || '', email: account?.email || '', mobile: account?.contact || '',
    property: stay?.property_name || '', room: stay?.room_label || '', moveIn: stay?.tenancy_started_at?.slice(0, 10) || '', status: stay?.tenancy_status === 'ACTIVE' ? 'Active' as const : 'Inactive' as const,
    verified: account?.email_verified || false, paymentReminders: true, maintenanceUpdates: true, communityAnnouncements: true }
}
export function workspaceResidents() {
  if (!session) return []
  if (session.account.role !== 'OWNER') return hasActiveStay(session.applications) || hasEndedStay(session.applications) ? [workspaceResident()] : []
  return session.applications.filter(a => a.tenancy_id).map(a => ({
    ...workspaceResident(), id: a.id, fullName: a.full_name, email: a.email, mobile: a.contact,
    property: a.property_name, room: a.room_label || '', moveIn: a.tenancy_started_at?.slice(0, 10) || '', status: a.tenancy_status === 'ACTIVE' ? 'Active' as const : 'Inactive' as const, verified: a.email_verified,
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
