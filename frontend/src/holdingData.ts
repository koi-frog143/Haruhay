import { getWorkspaceSession, isLiveWorkspace, workspaceStorageKey } from './workspaceSession'
import { api } from './registrationApi'
import { useCallback, useEffect, useState } from 'react'

import { CURRENT_RESIDENT_ID, getResidents } from './residentsData'

export type ResidentId = string
export const CURRENT_RESIDENT: ResidentId = CURRENT_RESIDENT_ID
export function getHoldingResidents(): Record<string, { name: string; room: string; propertyId?: string }> {
  const properties = new Map<string, string>()
  getWorkspaceSession()?.applications.forEach(application => properties.set(application.id, application.property_id))
  return Object.fromEntries(getResidents().map(resident => [resident.id, {
    name: resident.fullName, room: resident.room, propertyId: properties.get(resident.id),
  }]))
}
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
  pin: string | null
  status: 'Ready' | 'Claimed'
  claimed?: string
  history: string[]
  residentName?: string
  room?: string
  propertyId?: string
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
const EMPTY: HoldingState = { items: [], inquiries: [], nextId: 45 }
let liveState = EMPTY

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
    typeof item.residentId === 'string' && Object.hasOwn(getHoldingResidents(), item.residentId) &&
    (item.status === 'Ready' || item.status === 'Claimed') && Array.isArray(item.history) && item.history.every(line => typeof line === 'string') &&
    (item.claimed === undefined || typeof item.claimed === 'string')
}
export function getHoldingState(): HoldingState {
  if (isLiveWorkspace()) return liveState
  try {
    const value = JSON.parse(sessionStorage.getItem(workspaceStorageKey(KEY)) ?? 'null') as HoldingState | null
    if (value && Number.isSafeInteger(value.nextId) && value.nextId >= 45 && Array.isArray(value.items) && value.items.every(isItem) &&
      value.nextId > Math.max(0, ...value.items.map(item => item.id)) && Array.isArray(value.inquiries) &&
      value.inquiries.every(entry => entry && ['id', 'time', 'name', 'identity', 'lookingFor', 'purpose', 'result'].every(key => typeof (entry as unknown as Record<string, unknown>)[key] === 'string'))) return value
  } catch { /* Invalid or unavailable session data falls back to the sample records. */ }
  return isLiveWorkspace() ? { items: [], inquiries: [], nextId: 45 } : seed()
}
export function saveHoldingState(state: HoldingState) {
  if (isLiveWorkspace()) throw new Error('Live Holding Station changes must be saved through the backend.')
  sessionStorage.setItem(workspaceStorageKey(KEY), JSON.stringify(state))
  window.dispatchEvent(new Event(EVENT))
}

export async function fetchHoldingState(): Promise<HoldingState> {
  if (!isLiveWorkspace()) return getHoldingState()
  const session = getWorkspaceSession()
  if (!session) throw new Error('Sign in to load Holding Station records.')
  const owner = session.account.role === 'OWNER'
  const [items, inquiries] = await Promise.all([
    api<HoldingItem[]>(owner ? '/owner/holding-items' : '/resident/holding-items'),
    owner ? api<HoldingInquiry[]>('/owner/holding-inquiries') : Promise.resolve([]),
  ])
  const rows = items.map(item => ({
    ...item,
    residentId: owner ? item.residentId : CURRENT_RESIDENT_ID,
    history: Array.isArray(item.history) ? item.history : [],
  }))
  liveState = {
    items: rows,
    inquiries,
    nextId: Math.max(45, ...rows.map(item => item.id + 1)),
  }
  window.dispatchEvent(new Event(EVENT))
  return liveState
}

export function useHoldingState() {
  const [state, setState] = useState(getHoldingState)
  const [loadError, setLoadError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const current = await fetchHoldingState()
      setState(current)
      setLoadError('')
      return current
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load Holding Station records.')
      throw error
    }
  }, [])
  useEffect(() => {
    const update = () => setState(getHoldingState())
    const workspaceChanged = () => {
      if (isLiveWorkspace()) refresh().catch(() => {})
      else { setLoadError(''); update() }
    }
    window.addEventListener(EVENT, update)
    window.addEventListener('haruhay-workspace-changed', workspaceChanged)
    const timer = isLiveWorkspace() ? window.setTimeout(() => refresh().catch(() => {}), 0) : undefined
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener(EVENT, update)
      window.removeEventListener('haruhay-workspace-changed', workspaceChanged)
    }
  }, [refresh])
  return { state, loadError, refresh }
}

