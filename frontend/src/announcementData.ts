import { readPreview, savePreview, manilaInputDate } from './previewStore'
import { isLiveWorkspace } from './workspaceSession'

export type Announcement = { id: string; title: string; description: string; detail: string; date: string; icon: string; category: 'General notice' | 'Maintenance' | 'Community'; published: boolean; updatedAt: string }
const seed: Announcement[] = [
  { id: 'quiet', title: 'A little reminder to care for our shared home.', description: 'Quiet hours begin at 10 PM. Thank you for making Haruhay restful and welcoming to all neighbors.', detail: 'Please keep music, calls and shared-area conversations quiet after 10 PM. If you need help with a concern, visit the front desk.', date: 'October 8, 2026', icon: 'community-heart-featured.svg', category: 'General notice', published: true, updatedAt: '2026-10-08T09:00' },
  { id: 'water', title: 'Water advisory', description: 'Scheduled interruption October 9, 8–11 AM.', detail: 'Sample notice: store enough water before the scheduled maintenance. Visit the front desk for assistance.', date: 'October 8, 2026', icon: 'community-droplet.svg', category: 'Maintenance', published: true, updatedAt: '2026-10-08T08:00' },
  { id: 'cleanup', title: 'Community clean-up', description: 'Saturday gathering — everyone is welcome.', detail: 'Meet in the common area at 9 AM on October 10. Participation is optional; ask the front desk about supplies.', date: 'October 7, 2026', icon: 'community-heart-card.svg', category: 'Community', published: true, updatedAt: '2026-10-07T09:00' },
  { id: 'meeting', title: 'House meeting', description: 'October 17 at 4 PM in the common room.', detail: 'Bring your questions about shared spaces and house routines. Residents who cannot attend can leave a note with the front desk.', date: 'October 6, 2026', icon: 'community-calendar.svg', category: 'Community', published: true, updatedAt: '2026-10-06T09:00' },
]
function valid(value: unknown): value is Announcement[] { return Array.isArray(value) && value.every(row => row && ['id', 'title', 'description', 'detail', 'date', 'icon', 'updatedAt'].every(key => typeof row[key] === 'string') && ['General notice', 'Maintenance', 'Community'].includes(row.category) && typeof row.published === 'boolean') }
export function getAllAnnouncements() { return isLiveWorkspace() ? [] : readPreview('haruhay-announcements', seed, valid) }
export function getAnnouncements() { return getAllAnnouncements().filter(item => item.published) }
export function saveAnnouncement(input: Pick<Announcement, 'title' | 'description' | 'detail' | 'category' | 'published'>, id?: string) {
  if (isLiveWorkspace()) throw new Error('Open the announcement manager to save a property notice.')
  if (!input.title.trim() || !input.description.trim()) throw new Error('Enter a title and notice text.')
  const rows = getAllAnnouncements()
  const previous = rows.find(row => row.id === id)
  if (id && !previous) throw new Error('This announcement no longer exists.')
  const updatedAt = manilaInputDate()
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
  const row: Announcement = { ...input, id: previous?.id ?? crypto.randomUUID(), title: input.title.trim(), description: input.description.trim(), detail: input.detail.trim(), date, updatedAt, icon: previous?.icon ?? (input.category === 'Maintenance' ? 'community-droplet.svg' : 'community-heart-card.svg') }
  savePreview('haruhay-announcements', previous ? rows.map(item => item.id === id ? row : item) : [row, ...rows])
}
