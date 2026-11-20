import { getResidents } from './residentsData'
import { getAllVisits } from './visitorData'
import { getLedgerPayments, periodLabel } from './billingData'
import { getAllMaintenanceTickets } from './maintenanceData'
import { getHoldingState } from './holdingData'

export type ReportKind = 'Residents' | 'Visitors' | 'Payments' | 'Maintenance' | 'Holding station'
function dateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/u.test(value)) return value.slice(0, 10)
  const parsed = Date.parse(value.split('•')[0].trim())
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(parsed)) : ''
}
export function reportRows(kind: ReportKind, start: string, end: string): string[][] {
  const inRange = (value: string) => { const date = dateKey(value); return !!date && date >= start && date <= end }
  const residents = getResidents()
  const name = (id: string) => residents.find(resident => resident.id === id)?.fullName ?? id
  if (kind === 'Residents') return [['Resident ID', 'Name', 'Email', 'Room', 'Move-in date', 'Status'], ...residents.filter(resident => inRange(resident.moveIn)).map(resident => [resident.id, resident.fullName, resident.email, resident.room, resident.moveIn, resident.status])]
  if (kind === 'Visitors') return [['Visitor', 'Host', 'Expected arrival', 'Checked in', 'Checked out', 'Status'], ...getAllVisits().filter(visit => inRange(visit.checkedIn || visit.arrival)).map(visit => [visit.fullName, name(visit.residentId), visit.arrival, visit.checkedIn, visit.checkedOut, visit.status])]
  if (kind === 'Payments') return [['Resident', 'Period', 'Date', 'Amount PHP', 'Method', 'Reference', 'Status', 'Review note'], ...getLedgerPayments().filter(payment => inRange(payment.date)).map(payment => [name(payment.residentId), periodLabel(payment.period), payment.date, String(payment.amount), payment.method, payment.reference, payment.status, payment.reviewNote])]
  if (kind === 'Maintenance') return [['Ticket ID', 'Issue', 'Resident', 'Location', 'Submitted', 'Assigned to', 'Priority', 'Status'], ...getAllMaintenanceTickets().filter(ticket => inRange(ticket.submitted)).map(ticket => [ticket.id, ticket.title, name(ticket.residentId ?? ''), ticket.location, ticket.submitted, ticket.assignedTo, ticket.priority ?? 'Normal', ticket.status])]
  return [['Code', 'Item', 'Recipient', 'Shelf', 'Received', 'Status'], ...getHoldingState().items.filter(item => inRange(item.received)).map(item => [item.code, item.description, name(item.residentId), item.slot, item.received, item.status])]
}
