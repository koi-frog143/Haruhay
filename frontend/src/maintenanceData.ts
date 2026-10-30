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
  try {
    const value = sessionStorage.getItem(TICKETS_KEY)
    return value ? JSON.parse(value) as MaintenanceTicket[] : []
  } catch {
    return []
  }
}

export function getMaintenanceTickets() {
  return [...readStoredTickets(), ...seedMaintenanceTickets]
}

export function getMaintenanceTicket(id: string) {
  return getMaintenanceTickets().find(ticket => ticket.id === id) ?? seedMaintenanceTickets[0]
}

export function createMaintenanceTicket(draft: MaintenanceDraft) {
  const stored = readStoredTickets()
  const id = `TCK-${1043 + stored.length}`
  const submitted = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())
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
  sessionStorage.setItem(TICKETS_KEY, JSON.stringify([ticket, ...stored]))
  sessionStorage.removeItem(DRAFT_KEY)
  return ticket
}

export function saveMaintenanceDraft(draft: MaintenanceDraft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

export function getMaintenanceDraft(): MaintenanceDraft | null {
  try {
    const value = sessionStorage.getItem(DRAFT_KEY)
    return value ? JSON.parse(value) as MaintenanceDraft : null
  } catch {
    return null
  }
}
