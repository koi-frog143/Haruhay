import { readPreview, savePreview } from './previewStore'
import { getSettings } from './settingsData'

export const CURRENT_RESIDENT_ID = 'RES-0204'
export type ResidentRecord = { id: string; fullName: string; email: string; mobile: string; room: string; moveIn: string; status: 'Active' | 'Inactive'; verified: boolean; paymentReminders: boolean; maintenanceUpdates: boolean; communityAnnouncements: boolean }
export type ResidentInput = Pick<ResidentRecord, 'fullName' | 'email' | 'mobile' | 'room' | 'moveIn' | 'status' | 'verified'>
const preferences = { paymentReminders: true, maintenanceUpdates: true, communityAnnouncements: true }
function defaults(): ResidentRecord[] {
  const legacy = readPreview<Record<string, unknown>>('haruhay-resident-profile', {}, (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value))
  const rows: ResidentRecord[] = [
    { id: CURRENT_RESIDENT_ID, fullName: 'Andrea Santos', email: 'andrea.santos@email.com', mobile: '0917 123 4567', room: '204', moveIn: '2026-06-15', status: 'Active', verified: true, ...preferences },
    { id: 'RES-0047', fullName: 'Luis Villanueva', email: 'luis.v@email.com', mobile: '0918 234 5678', room: '205', moveIn: '2026-05-21', status: 'Active', verified: true, ...preferences },
    { id: 'RES-0046', fullName: 'Sofia Garcia', email: 'sofia.g@email.com', mobile: '0919 345 6789', room: '108', moveIn: '2026-04-05', status: 'Active', verified: true, ...preferences },
    { id: 'RES-0045', fullName: 'Kevin Reyes', email: 'kevin.r@email.com', mobile: '0920 456 7890', room: '302', moveIn: '2026-02-19', status: 'Active', verified: true, ...preferences },
    { id: 'RES-0101', fullName: 'Marco Ramos', email: 'marco.r@email.com', mobile: '0921 567 8901', room: '101', moveIn: '2026-01-10', status: 'Active', verified: true, ...preferences },
    { id: 'RES-0312', fullName: 'Lea Torres', email: 'lea.t@email.com', mobile: '0922 678 9012', room: '312', moveIn: '2026-03-12', status: 'Inactive', verified: false, ...preferences },
  ]
  for (const key of ['fullName', 'email', 'mobile'] as const) if (typeof legacy[key] === 'string' && legacy[key].trim()) rows[0][key] = legacy[key]
  for (const key of ['paymentReminders', 'maintenanceUpdates', 'communityAnnouncements'] as const) if (typeof legacy[key] === 'boolean') rows[0][key] = legacy[key]
  return rows
}
function validResident(value: unknown): value is ResidentRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return ['id', 'fullName', 'email', 'mobile', 'room', 'moveIn'].every(key => typeof r[key] === 'string' && String(r[key]).trim()) && ['Active', 'Inactive'].includes(String(r.status)) && ['verified', 'paymentReminders', 'maintenanceUpdates', 'communityAnnouncements'].every(key => typeof r[key] === 'boolean')
}
export function getResidents(): ResidentRecord[] { return readPreview('haruhay-residents-v1', defaults(), (value): value is ResidentRecord[] => Array.isArray(value) && value.every(validResident) && value.some(resident => resident.id === CURRENT_RESIDENT_ID) && new Set(value.map(resident => resident.id)).size === value.length) }
export function getCurrentResident() { return getResidents().find(resident => resident.id === CURRENT_RESIDENT_ID)! }
export function getResident(id: string) { return getResidents().find(resident => resident.id === id) }
export function saveResident(input: ResidentInput, id?: string) {
  const residents = getResidents()
  const previous = id ? residents.find(resident => resident.id === id) : undefined
  if (id && !previous) throw new Error('This resident record no longer exists.')
  if (!input.fullName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.email)) throw new Error('Enter a full name and valid email address.')
  const digits = input.mobile.replace(/\D/gu, '').length
  if (!/^\+?[\d\s()-]{7,25}$/u.test(input.mobile) || digits < 7 || digits > 15) throw new Error('Enter a valid mobile number using 7–15 digits.')
  if (!getSettings().property.rooms.includes(input.room)) throw new Error('Choose a room from the property inventory.')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.moveIn) || !Number.isFinite(Date.parse(input.moveIn))) throw new Error('Choose a valid move-in date.')
  if (residents.some(resident => resident.id !== id && resident.email.toLowerCase() === input.email.trim().toLowerCase())) throw new Error('A resident already uses that email address.')
  if (input.status === 'Active' && residents.some(resident => resident.id !== id && resident.status === 'Active' && resident.room === input.room)) throw new Error('That room already has an active resident. Choose another room or change the account status.')
  const resident: ResidentRecord = { ...preferences, ...previous, ...input, fullName: input.fullName.trim(), email: input.email.trim(), mobile: input.mobile.trim(), id: previous?.id ?? `RES-${String(Math.max(312, ...residents.map(row => Number(row.id.replace('RES-', '')) || 0)) + 1).padStart(4, '0')}` }
  savePreview('haruhay-residents-v1', previous ? residents.map(row => row.id === id ? resident : row) : [...residents, resident])
  window.dispatchEvent(new Event('haruhay-profile-updated'))
  return resident
}
export function saveCurrentProfile(profile: Pick<ResidentRecord, 'fullName' | 'email' | 'mobile' | 'paymentReminders' | 'maintenanceUpdates' | 'communityAnnouncements'>) {
  const residents = getResidents()
  const current = getCurrentResident()
  if (residents.some(row => row.id !== current.id && row.email.toLowerCase() === profile.email.trim().toLowerCase())) throw new Error('That email address is already in use.')
  savePreview('haruhay-residents-v1', residents.map(row => row.id === current.id ? { ...row, ...profile } : row))
  window.dispatchEvent(new Event('haruhay-profile-updated'))
}
