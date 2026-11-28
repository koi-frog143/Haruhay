import { getCurrentResident, saveCurrentProfile } from './residentsData'

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
  return { paymentReminders, maintenanceUpdates, communityAnnouncements, fullName, email, mobile }
}

export function saveResidentProfile(profile: ResidentProfileData) {
  saveCurrentProfile(profile)
}

export function profileInitials(name: string) {
  return name.trim().split(/\s+/u).filter(Boolean).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase()
}

