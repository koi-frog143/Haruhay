import { api } from './registrationApi'

export const billStatus = { UNPAID: 'Unpaid', PARTIAL: 'Partially paid', PAID: 'Paid' }
export const paymentStatus = { PENDING: 'Waiting for verification', APPROVED: 'Approved', DECLINED: 'Declined', REVERSED: 'Reversed' }
export const paymentMethod = { GCASH: 'GCash', BANK_TRANSFER: 'Bank transfer', FRONT_DESK: 'Front desk' }
export type PaymentRole = 'owner' | 'resident'
export type Payment = {
  id: string; bill_id: string; corrects_id: string | null; property_id: string; amount: number
  method: keyof typeof paymentMethod; payment_date: string; reference: string; status: keyof typeof paymentStatus
  submitted_at: string; period: string; due_date: string; total: number; balance: number; application_id: string
  bill_status: keyof typeof billStatus; resident_name: string; property_name: string; room_label: string
  decline_reason: string | null; reversal_reason: string | null; receipt_number: number | null; verified_at: string | null
  has_proof: boolean; duplicate_reference: boolean; has_correction: boolean
}
export type Receipt = {
  number: number; property_name: string; resident_name: string; room_label: string; issued_at: string
  amount: number; method: keyof typeof paymentMethod; reference: string; payment_date: string; status: 'APPROVED' | 'REVERSED'
  period: string; due_date: string; reversal_reason: string | null; reversed_at: string | null
}
export type Collections = { outstanding: number; months: Record<string, number>; period: string }
export const paymentPath = (role: PaymentRole, id?: string) => '/' + role + '/payments' + (id ? '/' + encodeURIComponent(id) : '')
export const receiptLink = (id: string) => '#/resident/payments/receipt/' + encodeURIComponent(id)
export function proofLink(role: PaymentRole, id: string) { return '/api' + paymentPath(role, id) + '/proof' }
export function receiptNumber(number: number) { return 'HR-' + String(number).padStart(6, '0') }
export function paymentDateLabel(date: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(date + 'T00:00:00+08:00'))
}
export function uploadPaymentProof(id: string, file: File) {
  const form = new FormData()
  form.set('proof', file)
  return api(paymentPath('resident', id) + '/proof', form)
}
