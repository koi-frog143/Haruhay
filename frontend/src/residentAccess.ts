import { manilaInputDate } from './previewStore'

export type AccessDirection = 'ENTRY' | 'EXIT'
export type AccessMovement = {
  id: string
  direction: AccessDirection
  entryPoint: string
  propertyName: string
  roomLabel: string
  identityConfirmed: boolean
  occurredAt: string
}
export type AccessResident = { tenancyId: string; name: string; propertyName: string; roomLabel: string }
export type StaffMovement = { movement: AccessMovement; residentName: string; revision: number; voided: boolean }
export type AccessHistoryPage = { records: StaffMovement[]; hasNext: boolean }
export type AccessAudit = {
  original: AccessMovement
  recordedBy: string
  corrections: { revision: number; direction: AccessDirection; entryPoint: string; voided: boolean; reason: string; correctedBy: string; correctedAt: string }[]
}

export const accessDirection = { ENTRY: 'Entry', EXIT: 'Exit' } as const
export const accessPath = (property: string) => `/logbook/properties/${property}/resident-access`

const date = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const time = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

export function accessDate(value: string) {
  const instant = new Date(value)
  return { isoDate: manilaInputDate(instant).slice(0, 10), date: date.format(instant), time: time.format(instant) }
}

type AccessRow = {
  isoDate: string; date: string; time: string; activity: string; entryPoint: string
  verification: string; propertyName: string; roomLabel: string
}

export function buildAccessExport(records: AccessRow[], from: string, through: string, includeStay: boolean) {
  const matching = records.filter(record => record.isoDate >= from && record.isoDate <= through)
  return {
    count: matching.length,
    rows: [
      ['Date (PHT)', 'Time (PHT)', 'Activity', 'Entry point', 'Verification', ...(includeStay ? ['Property', 'Room'] : [])],
      ...matching.map(record => [record.date, record.time, record.activity, record.entryPoint, record.verification,
        ...(includeStay ? [record.propertyName, record.roomLabel] : [])]),
    ],
  }
}
