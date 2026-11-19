import { readPreview, savePreview } from './previewStore'

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
  return readPreview<MaintenanceTicket[]>(TICKETS_KEY, [], (value): value is MaintenanceTicket[] => Array.isArray(value) && value.every(ticket => ticket && ['id', 'title', 'submitted', 'category', 'categoryLabel', 'location', 'description', 'assignedTo', 'comment'].every(key => typeof ticket[key] === 'string') && ['Submitted', 'Assigned', 'In progress', 'Resolved'].includes(ticket.status)))
}

export function getMaintenanceTickets() {
  return [...readStoredTickets(), ...seedMaintenanceTickets]
}

export function getMaintenanceTicket(id: string) {
  return getMaintenanceTickets().find(ticket => ticket.id === id)
}

export function createMaintenanceTicket(draft: MaintenanceDraft) {
  if (![draft.title, draft.description, draft.location, draft.category].every(value => value.trim())) throw new Error('Complete all required fields using non-empty text.')
  const stored = readStoredTickets()
  const id = `TCK-${Math.max(1042, ...getMaintenanceTickets().map(ticket => Number(ticket.id.replace('TCK-', '')) || 0)) + 1}`
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

export function getTicketComments(id: string): string[] {
  return readPreview<string[]>(`haruhay-comments-${id}`, [], (value): value is string[] => Array.isArray(value) && value.every(comment => typeof comment === 'string'))
}
export function saveTicketComment(id: string, message: string) {
  if (!getMaintenanceTicket(id)) throw new Error('This maintenance request could not be found.')
  if (!message.trim() || message.trim().length > 300) throw new Error('Enter a comment of 1–300 characters.')
  savePreview(`haruhay-comments-${id}`, [...getTicketComments(id), message.trim()])
}
