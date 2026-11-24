import type { RoomOffer } from './RoomFlow'
export type Account = { id: string; email: string; full_name: string; contact: string; role: 'OWNER' | 'APPLICANT' | 'GUARD' | 'TECHNICIAN'; email_verified: boolean }
export type Room = { id: string; property_id: string; property_name: string; label: string; capacity: number; held: number; active: number; sample: boolean }
export type Application = { id: string; invitation_id: string; email: string; full_name: string; contact: string; status: string; review_reason: string | null; reservation_status: string; property_name: string; room_label: string; email_verified: boolean; sample: boolean }
export type Invitation = { id: string; email: string; status: string; token_expires_at: string; reservation_status: string; property_name: string; room_label: string; application_status: string | null; sample: boolean }
export type IssuedInvitation = { id: string; token: string; link: string; expiresAt: string; message: string }
export type InvitationInfo = { propertyName: string; roomLabel: string; capacity: number; sample: boolean; expiresAt: string }
export type Delivery = { delivery: 'LOCAL_FILE' | 'SMTP_ACCEPTED' | 'NOT_REQUIRED' | 'FAILED' }
export type AuditEvent = { event: string; occurred_at: string; actor_email: string | null; reason: string | null }
export type Property = { id: string; name: string; sample?: boolean }
export type Admission = Application & { offers?:RoomOffer[]; reviewed_at: string | null; property_id: string; room_id: string | null; activation_pending: boolean; code_expires_at: string | null; failed_attempts: number | null }
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
type Csrf = { headerName: string; token: string }
let csrfRequest: Promise<Csrf> | null = null
function csrf() {
  // Initial parallel requests (including React StrictMode) must share session creation.
  // Separate bootstrap requests can otherwise race their Set-Cookie headers.
  if (!csrfRequest) csrfRequest = fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new ApiError(response.status, 'Unable to start a secure session. Check the backend and try again.')
      return response.json() as Promise<Csrf>
    }).finally(() => { csrfRequest = null })
  return csrfRequest
}
export async function api<T>(path: string, body?: object | URLSearchParams | FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) {
    const security = await csrf()
    headers[security.headerName] = security.token
    if (!(body instanceof FormData)) headers['Content-Type'] = body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json'
  }
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, cache: 'no-store',
    body: body === undefined ? undefined : body instanceof URLSearchParams || body instanceof FormData ? body : JSON.stringify(body),
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({ message: 'The backend is unavailable. Start Spring Boot and try again.' })) as { message?: string; fields?: { field: string; message: string }[] }
  if (!response.ok) throw new ApiError(response.status, (data.message || 'Request failed.') + (data.fields ? ' ' + data.fields.map(f => f.field + ': ' + f.message).join('; ') : ''))
  return data as T
}
export function deliveryText(result: Delivery) {
  return result.delivery === 'LOCAL_FILE'
    ? 'Local development: no email was sent. Open the verification link in the backend .local/mail/<account-id>.txt file. Keep this file private.'
    : result.delivery === 'NOT_REQUIRED' ? 'Your email is already verified.'
      : 'The mail server accepted your verification message. Check your inbox; delivery may take a moment.'
}
