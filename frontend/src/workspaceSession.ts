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
  const hasBilling = owner || (!staff && applications.some(a => a.status === 'APPROVED'))
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
  if (session?.account.id !== identity.id) clearVisitorRecords()
  session = next
  setWorkspaceMode('live')
  await Promise.all([
    staff ? Promise.resolve() : loadVisitorRecords().catch(() => null),
    owner || identity.role === 'TECHNICIAN' || applications.some(a => a.status === 'APPROVED') ? refreshMaintenance() : Promise.resolve(),
  ])
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
