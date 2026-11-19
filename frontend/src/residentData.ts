import { readPreview, savePreview, manilaInputDate } from './previewStore'

export const money = (amount: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(amount)
export const upcomingBill = { period: 'October 2026', due: '2026-10-15', rent: 3000, utilities: 500, outstanding: 0 }
export const upcomingTotal = upcomingBill.rent + upcomingBill.utilities + upcomingBill.outstanding
export const billDueLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(upcomingBill.due + 'T00:00:00+08:00'))
export const billTiming = () => {
  const days = Math.round((Date.parse(upcomingBill.due + 'T00:00:00+08:00') - Date.parse(manilaInputDate().slice(0, 10) + 'T00:00:00+08:00')) / 86400000)
  return days < 0 ? `${-days} days past sample due date` : days === 0 ? 'Due today' : `${days} days remaining`
}

export type Payment = { period: string; date: string; method: string; amount: string; status: 'Paid' | 'Pending' }
export const payments: Payment[] = [
  { period: 'September 2026', date: 'Sep 14, 2026', method: 'GCash', amount: money(3500), status: 'Paid' },
  { period: 'August 2026', date: 'Aug 13, 2026', method: 'GCash', amount: money(3500), status: 'Paid' },
  { period: 'July 2026', date: 'Jul 15, 2026', method: 'Bank transfer', amount: money(3500), status: 'Paid' },
  { period: 'June 2026', date: 'Jun 12, 2026', method: 'GCash', amount: money(3500), status: 'Paid' },
  { period: 'May 2026', date: 'May 15, 2026', method: 'Bank transfer', amount: money(3500), status: 'Paid' },
]
export const paymentChannels = ['GCash', 'Bank transfer', 'Front desk'] as const
export type PaymentChannel = typeof paymentChannels[number]
export function getPaymentChannel() { return readPreview<PaymentChannel>('haruhay-payment-channel', 'GCash', (value): value is PaymentChannel => paymentChannels.includes(value as PaymentChannel)) }
export function savePaymentChannel(value: PaymentChannel) { savePreview('haruhay-payment-channel', value) }

export const accessRecords = [
  { date: 'Oct 12, 2026', isoDate: '2026-10-12', time: '8:11 AM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 12, 2026', isoDate: '2026-10-12', time: '7:19 AM', activity: 'Resident check-out', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 11, 2026', isoDate: '2026-10-11', time: '9:25 PM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 11, 2026', isoDate: '2026-10-11', time: '8:03 AM', activity: 'Resident check-out', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 10, 2026', isoDate: '2026-10-10', time: '7:14 PM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
]
export const visitorEntries = [
  { person: 'Maria Santos', type: 'Guest', dateTime: 'Oct 8 · 10:32 AM', isoDate: '2026-10-08', location: 'Room 204', status: 'Checked in' },
  { person: 'John Mercado', type: 'Guest', dateTime: 'Oct 7 · 4:45 PM', isoDate: '2026-10-07', location: 'Room 204', status: 'Checked out' },
]

export type VisitorRequest = { id: string; fullName: string; contactNumber: string; purpose: string; expectedArrival: string; status: 'Pending review' | 'Cancelled' }
function isRequest(value: unknown): value is VisitorRequest {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return ['id', 'fullName', 'contactNumber', 'purpose', 'expectedArrival'].every(key => typeof row[key] === 'string') && (row.status === 'Pending review' || row.status === 'Cancelled') && Number.isFinite(Date.parse(String(row.expectedArrival)))
}
export function getVisitorRequests(): VisitorRequest[] {
  // Preserve requests written by the earlier resident form.
  const rows = readPreview<unknown[]>('haruhay-visitor-requests', [], (value): value is unknown[] => Array.isArray(value))
  return rows.map((value, index) => {
    if (!value || typeof value !== 'object') return null
    const row = { id: `legacy-${index}`, status: 'Pending review', ...value }
    return isRequest(row) ? row : null
  }).filter((row): row is VisitorRequest => row !== null)
}
export function createVisitorRequest(input: Omit<VisitorRequest, 'id' | 'status'>) {
  if (!input.fullName.trim() || !input.purpose.trim()) throw new Error('Enter a name and purpose for the visit.')
  if (!/^09\d{9}$/u.test(input.contactNumber.replace(/[\s-]/gu, ''))) throw new Error('Enter an 11-digit mobile number beginning with 09.')
  if (!Number.isFinite(Date.parse(input.expectedArrival)) || input.expectedArrival < manilaInputDate()) throw new Error('Choose an arrival time in the future (Philippine time).')
  const requests = getVisitorRequests()
  if (requests.some(row => row.status === 'Pending review' && row.fullName.toLowerCase() === input.fullName.toLowerCase() && row.expectedArrival === input.expectedArrival)) throw new Error('A pending request already exists for this guest and arrival time.')
  savePreview('haruhay-visitor-requests', [{ ...input, id: crypto.randomUUID(), status: 'Pending review' }, ...requests])
}
export function cancelVisitorRequest(id: string) { savePreview('haruhay-visitor-requests', getVisitorRequests().map(row => row.id === id ? { ...row, status: 'Cancelled' } : row)) }

export const announcements = [
  { id: 'quiet', title: 'A little reminder to care for our shared home.', description: 'Quiet hours begin at 10 PM. Thank you for making Haruhay restful and welcoming to all neighbors.', detail: 'Please keep music, calls and shared-area conversations quiet after 10 PM. If you need help with a concern, visit the front desk.', date: 'October 8, 2026', icon: 'community-heart-featured.svg' },
  { id: 'water', title: 'Water advisory', description: 'Scheduled interruption October 9, 8–11 AM.', detail: 'Sample notice: store enough water before the scheduled maintenance. Visit the front desk for assistance.', date: 'October 8, 2026', icon: 'community-droplet.svg' },
  { id: 'cleanup', title: 'Community clean-up', description: 'Saturday gathering — everyone is welcome.', detail: 'Meet in the common area at 9 AM on October 10. Participation is optional; ask the front desk about supplies.', date: 'October 7, 2026', icon: 'community-heart-card.svg' },
  { id: 'meeting', title: 'House meeting', description: 'October 17 at 4 PM in the common room.', detail: 'Bring your questions about shared spaces and house routines. Residents who cannot attend can leave a note with the front desk.', date: 'October 6, 2026', icon: 'community-calendar.svg' },
]

export type SupportRequest = { id: string; subject: string; message: string; created: string }
export function getSupportRequests() { return readPreview<SupportRequest[]>('haruhay-support', [], (value): value is SupportRequest[] => Array.isArray(value) && value.every(row => row && ['id', 'subject', 'message', 'created'].every(key => typeof row[key] === 'string'))) }
export function saveSupportRequest(subject: string, message: string) {
  if (!subject.trim() || !message.trim()) throw new Error('Enter a subject and message.')
  savePreview('haruhay-support', [{ id: crypto.randomUUID(), subject: subject.trim(), message: message.trim(), created: manilaInputDate() }, ...getSupportRequests()])
}
export function getReadNotifications() { return readPreview<string[]>('haruhay-read-notifications', [], (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string')) }
export function markNotificationsRead(ids: string[]) { savePreview('haruhay-read-notifications', [...new Set([...getReadNotifications(), ...ids])]) }
