import { useEffect, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './CommunityBoard.css'

const asset = (name: string) => `./assets/dashboard/${name}`

const announcements = [
  {
    title: 'Water advisory',
    description: 'Scheduled interruption tomorrow, 8–11 AM.',
    icon: 'community-droplet.svg',
  },
  {
    title: 'Community clean-up',
    description: 'Saturday gathering — everyone is welcome.',
    icon: 'community-heart-card.svg',
  },
  {
    title: 'House meeting',
    description: 'October 17 at 4 PM in the common room.',
    icon: 'community-calendar.svg',
  },
]

export default function CommunityBoard() {
  const [notice, setNotice] = useState('')

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
        <h2 id="community-featured-title">A little reminder to care for our shared home.</h2>
        <p>Quiet hours begin at 10 PM. Thank you for making Haruhay restful and welcoming to all neighbors.</p>
        <small>Posted October 8 • Management</small>
        <img src={asset('community-heart-featured.svg')} width="62" height="62" alt="" />
      </section>

      <section className="community-recent" aria-labelledby="community-recent-title">
        <div className="community-section-heading">
          <h2 id="community-recent-title">Recent announcements</h2>
          <button type="button" onClick={() => setNotice('You’re viewing all current community announcements.')}>View all <span aria-hidden="true">→</span></button>
        </div>

        <div className="community-card-grid">
          {announcements.map(announcement => <article className="community-card" key={announcement.title}>
            <span className="community-card-icon"><img src={asset(announcement.icon)} width="26" height="26" alt="" /></span>
            <h3>{announcement.title}</h3>
            <p>{announcement.description}</p>
          </article>)}
        </div>
      </section>
    </div>
  </ResidentLayout>
}
