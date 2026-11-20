import { readPreview, savePreview, manilaInputDate } from './previewStore'
import { CURRENT_RESIDENT_ID, getCurrentResident, getResident } from './residentsData'

export type MaintenanceStatus = 'Submitted' | 'Assigned' | 'In progress' | 'Resolved'

export type MaintenanceTicket = {
  id: string
  title: string
  submitted: string
  category: string
  categoryLabel: string
  location: string
  status: MaintenanceStatus
  description: string
  assignedTo: string
  comment: string
  residentId?: string
  priority?: 'Normal' | 'High'
  activity?: Array<{ text: string; created: string }>
}

export type MaintenanceDraft = {
  category: string
  location: string
  title: string
  description: string
}

const TICKETS_KEY = 'haruhay-maintenance-tickets'
const DRAFT_KEY = 'haruhay-maintenance-draft'

export const seedMaintenanceTickets: MaintenanceTicket[] = [
  {
    id: 'TCK-1042',
    title: 'Low water pressure',
    submitted: 'Oct 7, 2026',
    category: 'Plumbing',
    categoryLabel: 'Water & plumbing',
    location: 'Room 204',
    status: 'In progress',
    description: 'Water pressure in the upstairs bathroom has decreased significantly, especially during mornings.',
    assignedTo: 'Maintenance staff',
    comment: 'We have assigned Marco to inspect the water line.',
  },
  {
    id: 'TCK-1031',
    title: 'Hallway light flickering',
    submitted: 'Oct 2, 2026',
    category: 'Electrical',
    categoryLabel: 'Electrical',
    location: 'Second-floor hallway',
    status: 'Assigned',
    description: 'The hallway light near Room 204 flickers intermittently after sunset.',
    assignedTo: 'Maintenance staff',
    comment: 'An electrician has been assigned to inspect the fixture.',
  },
  {
    id: 'TCK-1025',
    title: 'Leaking bathroom faucet',
    submitted: 'Sep 24, 2026',
    category: 'Plumbing',
    categoryLabel: 'Water & plumbing',
    location: 'Room 204',
    status: 'Resolved',
    description: 'The bathroom faucet continued dripping after it was fully closed.',
    assignedTo: 'Maintenance staff',
    comment: 'The faucet cartridge was replaced and tested.',
  },
  {
    id: 'TCK-1012',
    title: 'AC unit inspection',
    submitted: 'Sep 17, 2026',
    category: 'Air conditioning',
    categoryLabel: 'Air conditioning',
    location: 'Room 204',
    status: 'Resolved',
    description: 'The air-conditioning unit needed a routine inspection and filter cleaning.',
    assignedTo: 'Maintenance staff',
    comment: 'The unit was cleaned, inspected, and returned to normal operation.',
  },
]

function readStoredTickets(): MaintenanceTicket[] {
  return readPreview<MaintenanceTicket[]>(TICKETS_KEY, [], (value): value is MaintenanceTicket[] => Array.isArray(value) && value.every(ticket => ticket && ['id', 'title', 'submitted', 'category', 'categoryLabel', 'location', 'description', 'assignedTo', 'comment'].every(key => typeof ticket[key] === 'string') && ['Submitted', 'Assigned', 'In progress', 'Resolved'].includes(ticket.status) && (ticket.priority === undefined || ['Normal', 'High'].includes(ticket.priority)) && (ticket.residentId === undefined || typeof ticket.residentId === 'string') && (ticket.activity === undefined || (Array.isArray(ticket.activity) && ticket.activity.every((item: { text: string; created: string }) => item && typeof item.text === 'string' && typeof item.created === 'string')))))
}

export function getAllMaintenanceTickets(): MaintenanceTicket[] {
  const extra: MaintenanceTicket[] = [
    { id: 'TCK-1043', residentId: 'RES-0045', priority: 'High', title: 'Broken hallway light', category: 'Electrical', categoryLabel: 'Electrical concern', location: 'Second floor, near Room 206', status: 'In progress', description: 'The shared hallway light flickers repeatedly and occasionally shuts off at night.', submitted: 'Oct 12, 2026', assignedTo: 'Marco Reyes', comment: 'Assigned to maintenance.', activity: [{ text: 'Assigned to maintenance', created: '2026-10-12T09:05' }] },
    { id: 'TCK-1040', residentId: 'RES-0045', priority: 'Normal', title: 'AC unit inspection', category: 'Air conditioning', categoryLabel: 'Air conditioning', location: 'Room 302', status: 'Assigned', description: 'Please inspect the air-conditioning unit.', submitted: 'Oct 10, 2026', assignedTo: 'Marco Reyes', comment: 'Inspection scheduled.' },
  ]
  const rows = new Map([...seedMaintenanceTickets, ...extra].map(ticket => [ticket.id, { ...ticket, residentId: ticket.residentId ?? CURRENT_RESIDENT_ID, priority: ticket.priority ?? 'Normal' as const }]))
  for (const ticket of readStoredTickets()) rows.set(ticket.id, { ...ticket, residentId: ticket.residentId ?? CURRENT_RESIDENT_ID, priority: ticket.priority ?? 'Normal' })
  return [...rows.values()]
}
export function getMaintenanceTickets() {
  return getAllMaintenanceTickets().filter(ticket => ticket.residentId === CURRENT_RESIDENT_ID)
}
export function getAdminMaintenanceTicket(id: string) { return getAllMaintenanceTickets().find(ticket => ticket.id === id) }
export function updateMaintenanceTicket(id: string, values: Pick<MaintenanceTicket, 'assignedTo' | 'status' | 'priority'>) {
  const ticket = getAdminMaintenanceTicket(id)
  if (!ticket) throw new Error('This maintenance request no longer exists.')
  if (!values.assignedTo.trim() || !['Submitted', 'Assigned', 'In progress', 'Resolved'].includes(values.status) || !['Normal', 'High'].includes(values.priority ?? '')) throw new Error('Choose a technician, priority and valid status.')
  const updated = { ...ticket, ...values, activity: [...(ticket.activity ?? []), { text: `${values.status} · Assigned to ${values.assignedTo} · ${values.priority} priority`, created: manilaInputDate() }] }
  savePreview(TICKETS_KEY, [updated, ...readStoredTickets().filter(row => row.id !== id)])
}

export function getMaintenanceTicket(id: string) {
  return getMaintenanceTickets().find(ticket => ticket.id === id)
}

export function createMaintenanceTicket(draft: MaintenanceDraft) {
  if (![draft.title, draft.description, draft.location, draft.category].every(value => value.trim())) throw new Error('Complete all required fields using non-empty text.')
  const stored = readStoredTickets()
  const id = `TCK-${Math.max(1043, ...getAllMaintenanceTickets().map(ticket => Number(ticket.id.replace('TCK-', '')) || 0)) + 1}`
  const submitted = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())
  const category = draft.category || 'General repair'
  const ticket: MaintenanceTicket = {
    id,
    title: draft.title,
    submitted,
    category,
    categoryLabel: category === 'Plumbing' ? 'Water & plumbing' : category,
    location: draft.location,
    status: 'Submitted',
    description: draft.description,
    assignedTo: 'Awaiting assignment',
    comment: 'Your request has been received. We will keep you updated here.',
    residentId: CURRENT_RESIDENT_ID,
    priority: 'Normal',
    activity: [{ text: `Request submitted by ${getCurrentResident().fullName}`, created: manilaInputDate() }],
  }
  savePreview(TICKETS_KEY, [ticket, ...stored])
  try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* Ticket is already saved. */ }
  return ticket
}

export function saveMaintenanceDraft(draft: MaintenanceDraft) {
  savePreview(DRAFT_KEY, draft)
}

export function getMaintenanceDraft(): MaintenanceDraft | null {
  return readPreview<MaintenanceDraft | null>(DRAFT_KEY, null, (value): value is MaintenanceDraft => !!value && typeof value === 'object' && ['category', 'location', 'title', 'description'].every(key => typeof (value as Record<string, unknown>)[key] === 'string'))
}

export type MaintenanceComment = { text: string; author: string; created: string }
export function getMaintenanceComments(id: string): MaintenanceComment[] {
  const comments = readPreview<Array<string | MaintenanceComment>>(`haruhay-comments-${id}`, [], (value): value is Array<string | MaintenanceComment> => Array.isArray(value) && value.every(comment => typeof comment === 'string' || (comment && typeof comment.text === 'string' && typeof comment.author === 'string' && typeof comment.created === 'string')))
  return comments.map(comment => typeof comment === 'string' ? { text: comment, author: 'Resident', created: '' } : comment)
}
export function getTicketComments(id: string) { return getMaintenanceComments(id).map(comment => comment.text) }
export function saveTicketComment(id: string, message: string, author = 'Resident') {
  const ticket = getAdminMaintenanceTicket(id)
  if (!ticket || !getResident(ticket.residentId ?? CURRENT_RESIDENT_ID)) throw new Error('This maintenance request could not be found.')
  if (!message.trim() || message.trim().length > 300) throw new Error('Enter a comment of 1–300 characters.')
  savePreview(`haruhay-comments-${id}`, [...getMaintenanceComments(id), { text: message.trim(), author, created: manilaInputDate() }])
}
