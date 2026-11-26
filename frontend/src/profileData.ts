import { getCurrentResident, saveCurrentProfile } from './residentsData'
import { isLiveWorkspace } from './workspaceSession'
import { readPreview, savePreview } from './previewStore'

export type ResidentProfileData = {
  fullName: string
  email: string
  mobile: string
  paymentReminders: boolean
  maintenanceUpdates: boolean
  communityAnnouncements: boolean
}

export function getResidentProfile(): ResidentProfileData {
  const { fullName, email, mobile, paymentReminders, maintenanceUpdates, communityAnnouncements } = getCurrentResident()
  const defaults = { paymentReminders, maintenanceUpdates, communityAnnouncements }
  const stored = isLiveWorkspace() ? readPreview('profile-preferences', defaults, (value): value is typeof defaults =>
    Boolean(value && typeof value === 'object' && Object.keys(defaults).every(key => typeof (value as Record<string, unknown>)[key] === 'boolean'))) : defaults
  return { ...stored, fullName, email, mobile }
}

export function saveResidentProfile(profile: ResidentProfileData) {
  if (isLiveWorkspace()) {
    const { paymentReminders, maintenanceUpdates, communityAnnouncements } = profile
    savePreview('profile-preferences', { paymentReminders, maintenanceUpdates, communityAnnouncements })
    window.dispatchEvent(new Event('haruhay-profile-updated'))
    return
  }
  saveCurrentProfile(profile)
}

export function profileInitials(name: string) {
  return name.trim().split(/\s+/u).filter(Boolean).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase()
}

