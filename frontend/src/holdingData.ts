import { useEffect, useState } from 'react'

export const HOLDING_RESIDENTS = {
  'RES-0204': { name: 'Andrea S.', room: '204' },
  'RES-0101': { name: 'Marco R.', room: '101' },
  'RES-0312': { name: 'Lea T.', room: '312' },
}
export type ResidentId = keyof typeof HOLDING_RESIDENTS
export const CURRENT_RESIDENT: ResidentId = 'RES-0204'
export const HOLDING_SLOTS = ['A-1', 'A-2', 'A-3', 'A-4', 'B-1', 'B-2']
export const HOLDING_CATEGORIES = ['Parcel', 'Letter / document', 'Food delivery', 'Other']
export type HoldingItem = {
  id: number
  code: string
  category: string
  description: string
  sender: string
  depositor: string
  tracking: string
  residentId: ResidentId
  slot: string
  received: string
  pin: string
  status: 'Ready' | 'Claimed'
  claimed?: string
  history: string[]
}
export type HoldingInquiry = {
  id: string
  time: string
  name: string
  identity: string
  lookingFor: string
  purpose: string
  result: string
}
export type HoldingState = { items: HoldingItem[]; inquiries: HoldingInquiry[]; nextId: number }
const KEY = 'haruhay-holding-station-v1'
const EVENT = 'haruhay-holding-updated'

function seed(): HoldingState {
  const rows: Array<[number, string, string, string, string, ResidentId, string, string, string, 'Ready' | 'Claimed']> = [
    [39, 'Parcel', 'Lazada package', 'Lazada', 'LZ-90321', 'RES-0204', 'A-1', 'Oct 2, 2026 • 3:15 PM', '480213', 'Claimed'],
    [41, 'Parcel', 'Shopee parcel', 'Shopee', 'SPX-77412', 'RES-0204', 'A-3', 'Oct 8, 2026 • 10:20 AM', '519304', 'Ready'],
    [42, 'Letter / document', 'Letter / document', 'City Hall', '', 'RES-0204', 'B-2', 'Oct 7, 2026 • 2:35 PM', '702158', 'Ready'],
    [43, 'Parcel', 'J&T parcel', 'J&T Express', 'JT-55120', 'RES-0101', 'A-2', 'Oct 9, 2026 • 9:05 AM', '338870', 'Ready'],
    [44, 'Letter / document', 'Bank statement', 'BPI', '', 'RES-0312', 'B-1', 'Oct 10, 2026 • 1:40 PM', '665902', 'Ready'],
  ]
  return { nextId: 45, inquiries: [], items: rows.map(([id, category, description, sender, tracking, residentId, slot, received, pin, status]) => ({
    id, code: holdingCode(id), category, description, sender, tracking, residentId, slot, received, pin, status,
    depositor: 'Courier / sender',
    claimed: status === 'Claimed' ? 'Oct 3' : undefined,
    history: ['Received • ' + received + ' • Shelf ' + slot, ...(status === 'Claimed' ? ['Collected • Oct 3 • Released to Andrea S.'] : [])],
  })) }
}
export function holdingCode(id: number) { return 'HS-' + String(id).padStart(4, '0') }
export function holdingNow() {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())
}
function isItem(value: unknown): value is HoldingItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return Number.isSafeInteger(item.id) && Number(item.id) > 0 &&
    ['code', 'category', 'description', 'sender', 'depositor', 'tracking', 'slot', 'received', 'pin'].every(key => typeof item[key] === 'string') &&
    typeof item.residentId === 'string' && Object.hasOwn(HOLDING_RESIDENTS, item.residentId) &&
    (item.status === 'Ready' || item.status === 'Claimed') && Array.isArray(item.history) && item.history.every(line => typeof line === 'string') &&
    (item.claimed === undefined || typeof item.claimed === 'string')
}
export function getHoldingState(): HoldingState {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as HoldingState | null
    if (value && Number.isSafeInteger(value.nextId) && value.nextId >= 45 && Array.isArray(value.items) && value.items.every(isItem) &&
      value.nextId > Math.max(0, ...value.items.map(item => item.id)) && Array.isArray(value.inquiries) &&
      value.inquiries.every(entry => entry && ['id', 'time', 'name', 'identity', 'lookingFor', 'purpose', 'result'].every(key => typeof (entry as unknown as Record<string, unknown>)[key] === 'string'))) return value
  } catch { /* Invalid or unavailable session data falls back to the sample records. */ }
  return seed()
}
export function saveHoldingState(state: HoldingState) {
  sessionStorage.setItem(KEY, JSON.stringify(state))
  window.dispatchEvent(new Event(EVENT))
}
export function useHoldingState() {
  const [state, setState] = useState(getHoldingState)
  useEffect(() => {
    const update = () => setState(getHoldingState())
    window.addEventListener(EVENT, update)
    return () => window.removeEventListener(EVENT, update)
  }, [])
  return state
}

