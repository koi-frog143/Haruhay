import { readPreview, savePreview, manilaInputDate } from './previewStore'

export { money, getBillingSummary, getResidentPayments } from './billingData'
export { getVisitorEntries, getVisitorRequests, createVisitorRequest, cancelVisitorRequest } from './visitorData'
export type { VisitorRequest } from './visitorData'
export { getAnnouncements } from './announcementData'

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
export type SupportRequest = { id: string; subject: string; message: string; created: string }
export function getSupportRequests() { return readPreview<SupportRequest[]>('haruhay-support', [], (value): value is SupportRequest[] => Array.isArray(value) && value.every(row => row && ['id', 'subject', 'message', 'created'].every(key => typeof row[key] === 'string'))) }
export function saveSupportRequest(subject: string, message: string) {
  if (!subject.trim() || !message.trim()) throw new Error('Enter a subject and message.')
  savePreview('haruhay-support', [{ id: crypto.randomUUID(), subject: subject.trim(), message: message.trim(), created: manilaInputDate() }, ...getSupportRequests()])
}
export function getReadNotifications() { return readPreview<string[]>('haruhay-read-notifications', [], (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string')) }
export function markNotificationsRead(ids: string[]) { savePreview('haruhay-read-notifications', [...new Set([...getReadNotifications(), ...ids])]) }
