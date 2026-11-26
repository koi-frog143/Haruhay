import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './CommunityBoard.css'
import { getAnnouncements } from './residentData'
import type { Announcement } from './announcementData'
import { usePreviewData } from './previewStore'
import ResidentDialog from './ResidentDialog'
import { announcementDate, announcementLink, categories, loadResidentNotices, residentAnnouncements, useNoticeList } from './announcementApi'
import type { ResidentNoticeDetail } from './announcementApi'
import { ApiError, api } from './registrationApi'
import { getWorkspaceSession, isLiveWorkspace } from './workspaceSession'

const asset = (name: string) => `./assets/dashboard/${name}`
const liveIcons = { GENERAL: 'community-calendar.svg', MAINTENANCE: 'community-droplet.svg', COMMUNITY: 'community-heart-card.svg' }
type BoardNotice = Pick<Announcement, 'id' | 'title' | 'description' | 'date' | 'icon' | 'category'> & { detail?: string; property?: string }

export default function CommunityBoard({ announcementId }: { announcementId?: string }) {
  const live = isLiveWorkspace()
  const preview = usePreviewData(getAnnouncements)
  const { rows, loading, error, refresh } = useNoticeList(loadResidentNotices, live)
  const showProperty = new Set(getWorkspaceSession()?.applications.filter(app => app.tenancy_status === 'ACTIVE').map(app => app.property_id)).size > 1
  const announcements: BoardNotice[] = live ? rows.map(row => ({
    id: row.id, title: row.title, description: row.summary, date: announcementDate(row.publishedAt),
    icon: liveIcons[row.category], category: categories[row.category], property: showProperty ? row.propertyName : undefined,
  })) : preview
  const [notice, setNotice] = useState('')
  const [allOpen, setAllOpen] = useState(false)
  const [selected, setSelected] = useState<BoardNotice | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const matching = announcements.filter(item => (!category || item.category === category) &&
    `${item.title} ${item.description} ${item.property ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const featured = announcements[0]

  useEffect(() => {
    document.title = 'Community announcements | Haruhay'
  }, [])

  return <ResidentLayout
    activeSection="Community"
    breadcrumb="Community"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content community-content">
      <header className="resident-page-heading">
        <span>HOME TOGETHER</span>
        <h1>Community announcements</h1>
        <p>The little updates that make sharing a space easier.</p>
      </header>

      {loading && <p className="resident-pending-requests" role="status">Loading announcements…</p>}
      {error && <div className="resident-pending-requests" role="alert"><p>{error}</p><button className="admin-secondary" onClick={refresh}>Try again</button></div>}
      {!loading && !error && (featured ? <section className={live ? 'community-featured live-featured' : 'community-featured'} aria-labelledby="community-featured-title">
        <span className="community-notice-badge">COMMUNITY NOTICE</span>
        <h2 id="community-featured-title">{featured.title}</h2>
        <p>{featured.description}</p>
        <small>{featured.date} · {featured.property ?? 'Management'}</small>
        <img src={asset('community-heart-featured.svg')} width="62" height="62" alt="" />
        {live && <a className="admin-secondary" href={announcementLink(featured.id)}>Read announcement</a>}
      </section> : <p className="resident-pending-requests">No published announcements yet.</p>)}

      {(!live || (!loading && !error && announcements.length > 0)) && <section className="community-recent" aria-labelledby="community-recent-title">
        <div className="community-section-heading">
          <h2 id="community-recent-title">Recent announcements</h2>
          <button type="button" onClick={() => { setQuery(''); setCategory(''); setAllOpen(true) }}>View all <span aria-hidden="true">→</span></button>
        </div>

        <div className="community-card-grid">
          {announcements.slice(1, live ? 4 : undefined).map(announcement => {
            const content = <>
              <span className="community-card-icon"><img src={asset(announcement.icon)} width="26" height="26" alt="" /></span>
              <h3>{announcement.title}</h3>
              <p>{announcement.description}</p>
              {live && <small>{announcement.category} · {announcement.property ? announcement.property + ' · ' : ''}{announcement.date}</small>}
            </>
            return live
              ? <a href={announcementLink(announcement.id)} className="community-card community-card-open live-community-card" key={announcement.id}>{content}</a>
              : <button type="button" className="community-card community-card-open" key={announcement.id} onClick={() => setSelected(announcement)}>{content}</button>
          })}
        </div>
      </section>}
      {!live && <p className="resident-preview-label">Local preview · management announcements</p>}
    </div>
    {allOpen && <ResidentDialog title="Community announcements" eyebrow="HOME TOGETHER" footerNote={live ? '' : undefined} onClose={() => setAllOpen(false)}>
      <div className="dialog-body">
        <label>Find an announcement<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {live && <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">All categories</option>{Object.values(categories).map(value => <option key={value}>{value}</option>)}
        </select></label>}
        <p role="status">{matching.length} {matching.length === 1 ? 'announcement' : 'announcements'}</p>
        <ul className="dialog-list">{matching.map(item => <li key={item.id}>
          <strong>{live ? <a href={announcementLink(item.id)}>{item.title}</a> : item.title}</strong>
          <small>{item.date} · {item.property ?? (live ? item.category : 'Management')}</small>
          <p>{item.description}</p>{!live && <p>{item.detail}</p>}
        </li>)}</ul>
        {!matching.length && <p>No announcements match your search.</p>}
      </div>
    </ResidentDialog>}
    {selected && <ResidentDialog title={selected.title} eyebrow="COMMUNITY NOTICE" onClose={() => setSelected(null)}><div className="dialog-body"><p>{selected.description}</p><p>{selected.detail}</p><small>{selected.date} · Management · Sample notice</small></div><button className="dialog-primary" onClick={() => setSelected(null)}>Done</button></ResidentDialog>}
    {live && announcementId !== undefined && <LiveAnnouncementDetail id={announcementId} />}
  </ResidentLayout>
}

function LiveAnnouncementDetail({ id }: { id: string }) {
  const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id)
  const [detail, setDetail] = useState<ResidentNoticeDetail | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  const close = () => { window.location.hash = '/resident/community' }

  useEffect(() => {
    if (!validId) return
    let active = true
    api<ResidentNoticeDetail>(residentAnnouncements + '/' + id).then(data => {
      if (active) setDetail(data)
    }).catch(error => {
      if (!active) return
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setUnavailable(true)
      else setError(error instanceof Error ? error.message : 'Could not load the announcement.')
    })
    return () => { active = false }
  }, [id, retry, validId])

  return <ResidentDialog title={detail?.announcement.title ?? 'Announcement'} eyebrow="COMMUNITY NOTICE" footerNote="" onClose={close}>
    <div className="dialog-body">
      {!validId || unavailable ? <p role="alert">This announcement is unavailable.</p>
        : error ? <><p role="alert">{error}</p><button className="admin-secondary" onClick={() => { setError(''); setRetry(retry + 1) }}>Try again</button></>
        : detail ? <>
          <small>{detail.announcement.propertyName} · {categories[detail.announcement.category]} · {announcementDate(detail.announcement.publishedAt)}</small>
          <p>{detail.announcement.summary}</p><p className="announcement-message">{detail.message}</p>
        </> : <p role="status">Loading announcement…</p>}
    </div>
    <a className="dialog-primary" href="#/resident/community">Back to community board</a>
  </ResidentDialog>
}
