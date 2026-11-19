import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './CommunityBoard.css'
import { announcements } from './residentData'
import ResidentDialog from './ResidentDialog'

const asset = (name: string) => `./assets/dashboard/${name}`


export default function CommunityBoard() {
  const [notice, setNotice] = useState('')
  const [allOpen, setAllOpen] = useState(false)
  const [selected, setSelected] = useState<typeof announcements[number] | null>(null)
  const [query, setQuery] = useState('')
  const matching = announcements.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()))

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

      <section className="community-featured" aria-labelledby="community-featured-title">
        <span className="community-notice-badge">COMMUNITY NOTICE</span>
        <h2 id="community-featured-title">{announcements[0].title}</h2>
        <p>{announcements[0].description}</p>
        <small>Posted October 8 • Management</small>
        <img src={asset('community-heart-featured.svg')} width="62" height="62" alt="" />
      </section>

      <section className="community-recent" aria-labelledby="community-recent-title">
        <div className="community-section-heading">
          <h2 id="community-recent-title">Recent announcements</h2>
          <button type="button" onClick={() => { setQuery(''); setAllOpen(true) }}>View all <span aria-hidden="true">→</span></button>
        </div>

        <div className="community-card-grid">
          {announcements.slice(1).map(announcement => <button type="button" className="community-card community-card-open" key={announcement.title} onClick={() => setSelected(announcement)}>
            <span className="community-card-icon"><img src={asset(announcement.icon)} width="26" height="26" alt="" /></span>
            <h3>{announcement.title}</h3>
            <p>{announcement.description}</p>
          </button>)}
        </div>
      </section>
      <p className="resident-preview-label">Sample community notices · October 2026</p>
    </div>
    {allOpen && <ResidentDialog title="Community announcements" eyebrow="HOME TOGETHER" onClose={() => setAllOpen(false)}><div className="dialog-body"><label>Find an announcement<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><p role="status">{matching.length} announcements</p><ul className="dialog-list">{matching.map(item => <li key={item.id}><strong>{item.title}</strong><small>{item.date} · Management</small><p>{item.description}</p><p>{item.detail}</p></li>)}</ul>{!matching.length && <p>No announcements match your search.</p>}</div></ResidentDialog>}
    {selected && <ResidentDialog title={selected.title} eyebrow="COMMUNITY NOTICE" onClose={() => setSelected(null)}><div className="dialog-body"><p>{selected.description}</p><p>{selected.detail}</p><small>{selected.date} · Management · Sample notice</small></div><button className="dialog-primary" onClick={() => setSelected(null)}>Done</button></ResidentDialog>}
  </ResidentLayout>
}
