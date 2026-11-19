import { getResidentProfile } from './profileData'
import { getHoldingState, CURRENT_RESIDENT } from './holdingData'
import { getMaintenanceTickets, getTicketComments } from './maintenanceData'
import { announcements, billDueLabel, getVisitorRequests, money, payments, upcomingTotal } from './residentData'

export const residentServices = [
  { title: 'Dashboard', description: 'Home and overview', href: '#/resident/dashboard' },
  { title: 'Logbook', description: 'Visitors, requests and guest activity', href: '#/resident/logbook' },
  { title: 'Access history', description: 'Check-ins and check-outs', href: '#/resident/logbook/access-history' },
  { title: 'Register visitor', description: 'Request a guest visit', href: '#/resident/logbook/register' },
  { title: 'Maintenance', description: 'Repairs and service requests', href: '#/resident/maintenance' },
  { title: 'New maintenance request', description: 'Report an issue', href: '#/resident/maintenance/new' },
  { title: 'Holding station', description: 'Packages and collection history', href: '#/resident/holding-station' },
  { title: 'Payments', description: 'Billing, upcoming rent and payment methods', href: '#/resident/payments' },
  { title: 'Payment history', description: 'Past payments, transactions and CSV exports', href: '#/resident/payments/history' },
  { title: 'Community', description: 'Announcements and house notices', href: '#/resident/community' },
  { title: 'My profile', description: 'Account details and notification preferences', href: '#/resident/profile' },
]
export function getSearchEntries() {
  return [...residentServices,
    ...getMaintenanceTickets().map(ticket => ({ title: `${ticket.id} · ${ticket.title}`, description: `${ticket.category} · ${ticket.status} · ${ticket.description}`, href: `#/resident/maintenance/${ticket.id}` })),
    ...announcements.map(item => ({ title: item.title, description: item.description, href: '#/resident/community' })),
    ...getHoldingState().items.filter(item => item.residentId === CURRENT_RESIDENT).map(item => ({ title: `${item.code} · ${item.description}`, description: `Package ${item.status} · Shelf ${item.slot}`, href: '#/resident/holding-station' })),
    ...getVisitorRequests().map(item => ({ title: item.fullName, description: `Visitor request · ${item.status} · ${item.purpose}`, href: '#/resident/logbook' })),
    ...payments.map(item => ({ title: item.period, description: `Payment ${item.amount} · ${item.method} · ${item.status}`, href: '#/resident/payments/history' })),
  ]
}
export function getNotifications() {
  const preferences = getResidentProfile()
  return [
    ...(preferences.paymentReminders ? [{ id: 'bill-2026-10', title: `Sample rent due ${billDueLabel}`, description: `${money(upcomingTotal)} · October 2026 sample bill`, href: '#/resident/payments' }] : []),
    ...getHoldingState().items.filter(item => item.residentId === CURRENT_RESIDENT && item.status === 'Ready').map(item => ({ id: `holding-${item.id}`, title: `${item.description} ready for pickup`, description: `${item.code} · Shelf ${item.slot}`, href: '#/resident/holding-station' })),
    ...(preferences.maintenanceUpdates ? getMaintenanceTickets().filter(ticket => ticket.status !== 'Resolved').map(ticket => ({ id: `ticket-${ticket.id}-${ticket.status}-${getTicketComments(ticket.id).length}`, title: ticket.title, description: `${ticket.id} · ${ticket.status}`, href: `#/resident/maintenance/${ticket.id}` })) : []),
    ...(preferences.communityAnnouncements ? announcements.map(item => ({ id: `announcement-${item.id}`, title: item.title, description: `${item.date} · Community notice`, href: '#/resident/community' })) : []),
    ...getVisitorRequests().filter(item => item.status === 'Pending review').map(item => ({ id: `request-${item.id}`, title: `${item.fullName}: pending review`, description: 'Saved locally; this is not a check-in.', href: '#/resident/logbook' })),
  ]
}
