import { readPreview, savePreview } from './previewStore'

export const staffPermissions = ['Residents', 'Visitors', 'Maintenance', 'Holding station', 'Billing', 'Announcements', 'Settings']
export type StaffMember = { id: string; name: string; role: 'Administrator' | 'Front desk' | 'Technician'; active: boolean; permissions: string[] }
export type PropertySettings = {
  property: { name: string; contact: string; rooms: string[]; amenities: string; rules: string }
  billing: { period: string; rent: number; utilities: number; dueDay: number; graceDays: number }
  notifications: { payments: boolean; maintenance: boolean; announcements: boolean; channel: 'In-app' | 'In-app and email' }
  security: { retentionDays: number; logChanges: boolean; requireIdentity: boolean }
  staff: StaffMember[]
}
const defaults: PropertySettings = {
  property: { name: 'Haruhay Residences', contact: 'Visit the property front desk', rooms: ['101', '108', '204', '205', '206', '302', '312'], amenities: 'Common room, shared kitchen, laundry area', rules: 'Quiet hours: 10 PM–6 AM. Keep shared spaces clean.' },
  billing: { period: '2026-10', rent: 3000, utilities: 500, dueDay: 15, graceDays: 3 },
  notifications: { payments: true, maintenance: true, announcements: true, channel: 'In-app' },
  security: { retentionDays: 365, logChanges: true, requireIdentity: true },
  staff: [ { id: 'staff-joy', name: 'Joy Dela Cruz', role: 'Administrator', active: true, permissions: [...staffPermissions] }, { id: 'staff-marco', name: 'Marco Reyes', role: 'Technician', active: true, permissions: ['Maintenance'] }, { id: 'staff-desk', name: 'Front desk team', role: 'Front desk', active: true, permissions: ['Visitors', 'Holding station'] } ],
}
function valid(value: unknown): value is PropertySettings {
  if (!value || typeof value !== 'object') return false
  const v = value as PropertySettings
  return !!v.property && ['name', 'contact', 'amenities', 'rules'].every(key => typeof (v.property as unknown as Record<string, unknown>)[key] === 'string') && Array.isArray(v.property.rooms) && v.property.rooms.length > 0 && v.property.rooms.every(room => typeof room === 'string' && room.trim()) &&
    !!v.billing && /^\d{4}-(0[1-9]|1[0-2])$/u.test(v.billing.period) && ['rent', 'utilities', 'dueDay', 'graceDays'].every(key => Number.isFinite((v.billing as unknown as Record<string, number>)[key])) && v.billing.rent >= 0 && v.billing.utilities >= 0 && Number.isInteger(v.billing.dueDay) && v.billing.dueDay >= 1 && v.billing.dueDay <= 28 && Number.isInteger(v.billing.graceDays) && v.billing.graceDays >= 0 && v.billing.graceDays <= 30 &&
    !!v.notifications && ['payments', 'maintenance', 'announcements'].every(key => typeof (v.notifications as unknown as Record<string, unknown>)[key] === 'boolean') && ['In-app', 'In-app and email'].includes(v.notifications.channel) &&
    !!v.security && Number.isInteger(v.security.retentionDays) && v.security.retentionDays >= 1 && v.security.retentionDays <= 3650 && typeof v.security.logChanges === 'boolean' && typeof v.security.requireIdentity === 'boolean' &&
    Array.isArray(v.staff) && v.staff.every(staff => staff && typeof staff.id === 'string' && typeof staff.name === 'string' && ['Administrator', 'Front desk', 'Technician'].includes(staff.role) && typeof staff.active === 'boolean' && Array.isArray(staff.permissions) && staff.permissions.every(permission => staffPermissions.includes(permission)))
}
export function getSettings() { return readPreview('haruhay-property-settings', defaults, valid) }
export function saveSettings(value: PropertySettings) {
  if (!valid(value) || !value.property.name.trim() || !value.property.contact.trim()) throw new Error('Complete the settings with valid values. Billing days must be 1–28 and retention 1–3650 days.')
  if (new Set(value.property.rooms).size !== value.property.rooms.length) throw new Error('Room numbers must be unique.')
  if (!value.staff.some(staff => staff.active && staff.role === 'Administrator')) throw new Error('Keep at least one active administrator in this preview.')
  if (value.staff.some(staff => !staff.name.trim())) throw new Error('Enter a name for every staff member.')
  savePreview('haruhay-property-settings', value)
}
