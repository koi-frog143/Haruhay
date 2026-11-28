export const supportStatus = {
  OPEN: 'Open',
  WAITING_FOR_RESIDENT: 'Waiting for resident',
  RESOLVED: 'Resolved',
} as const

export type SupportStatus = keyof typeof supportStatus
export type SupportRole = 'resident' | 'owner'
export type SupportSummary = {
  id: string
  propertyId: string
  propertyName: string
  residentName: string
  subject: string
  status: SupportStatus
  createdAt: string
  updatedAt: string
}
export type SupportEvent = {
  id: number
  author: string
  authorRole: 'RESIDENT' | 'OWNER'
  message: string | null
  previousStatus: SupportStatus | null
  newStatus: SupportStatus | null
  occurredAt: string
}
export type SupportDetail = { request: SupportSummary; events: SupportEvent[] }
export type SupportPage = { requests: SupportSummary[]; hasNext: boolean }
