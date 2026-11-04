export type ResidentProfileData = {
  fullName: string
  email: string
  mobile: string
  paymentReminders: boolean
  maintenanceUpdates: boolean
  communityAnnouncements: boolean
}

const STORAGE_KEY = 'haruhay-resident-profile'
const defaults: ResidentProfileData = {
  fullName: 'Andrea Santos',
  email: 'andrea.santos@email.com',
  mobile: '0917 123 4567',
  paymentReminders: true,
  maintenanceUpdates: true,
  communityAnnouncements: true,
}

export function getResidentProfile(): ResidentProfileData {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return { ...defaults }
    const values = stored as Record<string, unknown>
    const result = { ...defaults }
    for (const key of ['fullName', 'email', 'mobile'] as const) {
      if (key in stored && typeof values[key] === 'string' && values[key].trim()) result[key] = values[key]
    }
    for (const key of ['paymentReminders', 'maintenanceUpdates', 'communityAnnouncements'] as const) {
      if (key in stored && typeof values[key] === 'boolean') result[key] = values[key]
    }
    return result
  } catch {
    return { ...defaults }
  }
}

export function saveResidentProfile(profile: ResidentProfileData) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  window.dispatchEvent(new Event('haruhay-profile-updated'))
}

export function profileInitials(name: string) {
  return name.trim().split(/\s+/u).filter(Boolean).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase()
}

