import { api } from './registrationApi'

export const maintenanceStatus = {
  SUBMITTED: 'Submitted', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress',
  READY: 'Ready for confirmation', CLOSED: 'Closed', CANCELLED: 'Cancelled',
}
export const maintenancePriority = { ROUTINE: 'Routine', HIGH: 'High', CRITICAL: 'Critical' }
export type TicketStatus = keyof typeof maintenanceStatus
export type TicketPriority = keyof typeof maintenancePriority
export type MaintenanceRole = 'resident' | 'owner' | 'technician'
export type TicketAction = 'ASSIGN' | 'ESCALATE' | 'START' | 'PROGRESS' | 'READY' | 'REOPEN' | 'CLOSE' | 'CANCEL'
export type LiveTicket = {
  id: string; ticket_number: string; property_id: string; property_name: string; room_label: string
  resident_id: string; resident_name: string; category_label: string; description: string; location: string
  shared_area: boolean; priority: TicketPriority; status: TicketStatus; version: number
  technician_id: string | null; technician_name: string | null; needs_assignment: boolean; resident_can_update: boolean
  submitted_at: string; updated_at: string
}
export type TicketDetail = LiveTicket & {
  activity: { id: number; kind: string; message: string | null; materials: string | null; occurred_at: string; actor: string }[]
  photos: { id: string; uploaded_at: string }[]
}
export type MaintenanceNotice = {
  id: string; ticket_id: string; message: string; created_at: string; read_at: string | null
}
export type Technician = { id: string; full_name: string; email: string; enabled: boolean }
type Snapshot = { tickets: LiveTicket[]; notices: MaintenanceNotice[]; error: string }

const empty: Snapshot = { tickets: [], notices: [], error: '' }
let identity: string | null = null
let version = 0
let snapshot = empty
export function maintenanceSnapshot() { return snapshot }

function publish(value: Snapshot) {
  snapshot = value
  window.dispatchEvent(new Event('haruhay-preview-updated'))
}
if (typeof window !== 'undefined') {
  const onAccountChange = (event: Event) => {
    const next = (event as CustomEvent<{ accountId: string | null }>).detail?.accountId || null
    if (next === identity) return
    identity = next
    version++
    publish(empty)
  }
  window.addEventListener('haruhay-workspace-changed', onAccountChange)
  import.meta.hot?.dispose(() => window.removeEventListener('haruhay-workspace-changed', onAccountChange))
}
export async function refreshMaintenance() {
  const account = identity
  if (!account) return
  const request = ++version
  try {
    const [tickets, notices] = await Promise.all([
      api<LiveTicket[]>('/maintenance/tickets'),
      api<MaintenanceNotice[]>('/maintenance/notifications'),
    ])
    if (account === identity && request === version) publish({ tickets, notices, error: '' })
  } catch (error) {
    if (account === identity && request === version) publish({ ...snapshot, error: maintenanceError(error) })
  }
}
export async function readMaintenanceNotice(id?: string) {
  const account = identity
  await api('/maintenance/notifications/read', { id })
  if (account !== identity) return
  await refreshMaintenance()
}
export function maintenanceError(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load maintenance records. Try again.'
}
export function ticketPath(role: MaintenanceRole, id?: string) {
  const base = role === 'technician' ? '#/technician/jobs' : role === 'owner' ? '#/admin/maintenance' : '#/resident/maintenance'
  return id ? base + '/' + encodeURIComponent(id) : base
}
export function ticketTitle(ticket: LiveTicket) {
  const detail = ticket.description.trim().split(/\r?\n/u, 1)[0]
  return detail.length > 64 ? detail.slice(0, 61).trimEnd() + '…' : detail
}
export function isArchived(ticket: LiveTicket) { return ticket.status === 'CLOSED' || ticket.status === 'CANCELLED' }
export function uploadMaintenancePhoto(ticket: string, file: File) {
  const payload = new FormData()
  payload.set('photo', file)
  return api('/maintenance/tickets/' + ticket + '/photos', payload)
}
