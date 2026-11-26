import { useEffect, useState } from 'react'
import { api } from './registrationApi'

export const categories = { GENERAL: 'General notice', MAINTENANCE: 'Maintenance', COMMUNITY: 'Community' } as const
export const noticeStatuses = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' } as const
type Category = keyof typeof categories
export type NoticeContent = { title: string; category: Category; summary: string; message: string }
export type OwnerNotice = {
  id: string; propertyId: string; propertyName: string; author: string; content: NoticeContent
  status: keyof typeof noticeStatuses; createdAt: string; updatedAt: string; publishedAt: string | null
  archivedAt: string | null; version: number
}
export type ResidentNotice = Omit<NoticeContent, 'message'> & { id: string; propertyName: string; publishedAt: string }
export type ResidentNoticeDetail = { announcement: ResidentNotice; message: string }

const formatter = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' })
export const announcementDate = (date: string) => formatter.format(new Date(date))
export const announcementLink = (id: string) => '#/resident/community/' + encodeURIComponent(id)
export const ownerAnnouncements = '/owner/announcements'
export const residentAnnouncements = '/resident/announcements'
export const loadOwnerNotices = () => api<OwnerNotice[]>(ownerAnnouncements)
export const loadResidentNotices = () => api<ResidentNotice[]>(residentAnnouncements)

export function useNoticeList<T>(load: () => Promise<T[]>, enabled = true) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let active = true
    load().then(data => {
      if (active) setRows(data)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Could not load announcements.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [enabled, load, revision])
  function refresh() {
    setLoading(true)
    setError('')
    setRevision(value => value + 1)
  }
  return { rows, loading, error, refresh }
}
