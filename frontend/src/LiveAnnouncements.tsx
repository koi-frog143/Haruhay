import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AdminLayout from './AdminLayout'
import { AdminHeading, AdminStatus } from './AdminUI'
import { AnnouncementFields } from './AdminOperationsDialogs'
import ResidentDialog from './ResidentDialog'
import { announcementDate, categories, loadOwnerNotices, noticeStatuses, ownerAnnouncements, useNoticeList } from './announcementApi'
import type { NoticeContent, OwnerNotice } from './announcementApi'
import { api } from './registrationApi'
import type { Property } from './registrationApi'
import { getWorkspaceSession } from './workspaceSession'
import './CommunityBoard.css'

type Dialog = { action: 'create' } | { action: 'edit' | 'archive' | 'view'; notice: OwnerNotice }

export default function LiveAnnouncements() {
  const properties = getWorkspaceSession()?.properties.filter(property => !property.sample) ?? []
  const { rows, loading, error, refresh } = useNoticeList(loadOwnerNotices)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState('')
  const matching = rows.filter(row => !filter || row.status === filter)
  const close = () => setDialog(null)
  function saved(message: string) {
    close()
    setNotice(message)
    refresh()
  }

  return <AdminLayout active="Announcements" node="18:2776" notice={notice} onDismissNotice={() => setNotice('')}>
    <AdminHeading eyebrow="YOUR COMMUNITY" title="Announcements manager" description="Publish property notices for residents."
      action={<button className="admin-primary" disabled={!properties.length} onClick={() => setDialog({ action: 'create' })}>Create announcement</button>} />
    {loading ? <p role="status">Loading announcements…</p>
      : error ? <section className="admin-panel" role="alert"><p>{error}</p><button className="admin-secondary" onClick={refresh}>Try again</button></section>
      : <>
        {rows.length > 0 && <div className="admin-toolbar announcement-toolbar">
          <label>Show <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(noticeStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button className="admin-secondary" onClick={refresh}>Refresh announcements</button>
        </div>}
        <div className="admin-announcement-grid">
          {matching.map(row => <article className="admin-panel admin-announcement-card live-announcement-card" key={row.id}>
            <h2>{row.content.title}</h2>
            <div className="announcement-tags"><AdminStatus>{categories[row.content.category]}</AdminStatus><AdminStatus>{noticeStatuses[row.status]}</AdminStatus></div>
            <p>{row.content.summary}</p>
            <small>{row.propertyName} · {announcementDate(row.archivedAt ?? row.publishedAt ?? row.createdAt)}</small>
            <div className="admin-actions">
              {row.status === 'ARCHIVED'
                ? <button className="admin-secondary" onClick={() => setDialog({ action: 'view', notice: row })}>View announcement</button>
                : <>
                  <button className="admin-secondary" onClick={() => setDialog({ action: 'edit', notice: row })}>Edit announcement</button>
                  <button className="admin-secondary" onClick={() => setDialog({ action: 'archive', notice: row })}>Archive</button>
                </>}
            </div>
          </article>)}
        </div>
        {!matching.length && <section className="admin-panel">{rows.length ? 'No announcements match this status.'
          : properties.length ? 'No announcements yet. Create the first notice for your residents.'
          : <>Add a <a href="#/admin/property">property</a> to publish announcements.</>}</section>}
        {rows.length > 0 && <section className="admin-panel announcement-totals">
          <h2>Community communication</h2>
          <div className="admin-metrics">{Object.entries(noticeStatuses).map(([value, label]) =>
            <div key={value}><strong>{rows.filter(row => row.status === value).length}</strong><p>{label} notices</p></div>)}
          </div>
        </section>}
      </>}
    {dialog?.action === 'create' && <LiveEditor properties={properties} onClose={close} onSaved={saved} />}
    {dialog?.action === 'edit' && <LiveEditor properties={properties} notice={dialog.notice} onClose={close} onSaved={saved} />}
    {dialog?.action === 'archive' && <ArchiveDialog notice={dialog.notice} onClose={close} onSaved={saved} />}
    {dialog?.action === 'view' && <ResidentDialog title={dialog.notice.content.title} eyebrow="ARCHIVED ANNOUNCEMENT" footerNote="" onClose={close}>
      <div className="dialog-body">
        <p>{dialog.notice.propertyName} · {categories[dialog.notice.content.category]}</p>
        <p>{dialog.notice.content.summary}</p>
        <p className="announcement-message">{dialog.notice.content.message}</p>
        <small>Written by {dialog.notice.author} · Archived {announcementDate(dialog.notice.archivedAt ?? dialog.notice.updatedAt)}</small>
      </div>
    </ResidentDialog>}
  </AdminLayout>
}

function LiveEditor({ properties, notice, onClose, onSaved }: {
  properties: Property[]; notice?: OwnerNotice; onClose: () => void; onSaved: (message: string) => void
}) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const published = notice?.status === 'PUBLISHED'
  const fields = notice && {
    title: notice.content.title, description: notice.content.summary, detail: notice.content.message,
    category: categories[notice.content.category],
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const data = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const publish = submitter instanceof HTMLButtonElement && submitter.value === 'publish'
    const category = (Object.keys(categories) as NoticeContent['category'][]).find(key => categories[key] === data.get('category'))
    if (!category) return
    const content = {
      title: String(data.get('title') ?? '').trim(), category,
      summary: String(data.get('description') ?? '').trim(), message: String(data.get('detail') ?? '').trim(),
    }
    if (!content.title || !content.summary || !content.message) {
      setError('Enter a title, summary, and full message.')
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const saved = notice
        ? await api<OwnerNotice>(ownerAnnouncements + '/' + notice.id, { version: notice.version, content, publish }, 'PUT')
        : await api<OwnerNotice>(ownerAnnouncements, { requestId, propertyId: data.get('propertyId'), content, publish })
      onSaved(saved.status === 'PUBLISHED' ? published ? 'Announcement updated.' : 'Announcement published.' : 'Draft saved.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the announcement. Try again.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <ResidentDialog title={notice ? 'Edit announcement' : 'Create announcement'} eyebrow="COMMUNITY MANAGEMENT"
    onClose={onClose} footerNote="" dismissOnBackdrop={false} busy={busy}>
    <form className="admin-form" onSubmit={submit}>
      <div className="dialog-body">
        {notice ? <p><strong>{notice.propertyName}</strong> · {noticeStatuses[notice.status]}</p>
          : <label>Property<select name="propertyId" required defaultValue={properties.length === 1 ? properties[0].id : ''}>
            <option value="" disabled>Choose a property</option>
            {properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
          </select></label>}
        <AnnouncementFields announcement={fields} live />
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {published ? <button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        : <div className="admin-actions announcement-form-actions">
          <button className="admin-secondary" disabled={busy}>Save draft</button>
          <button className="admin-primary" value="publish" disabled={busy}>{busy ? 'Saving…' : 'Publish announcement'}</button>
        </div>}
    </form>
  </ResidentDialog>
}

function ArchiveDialog({ notice, onClose, onSaved }: { notice: OwnerNotice; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <ResidentDialog title="Archive announcement" eyebrow="COMMUNITY MANAGEMENT" busy={busy} onClose={onClose} footerNote="" dismissOnBackdrop={false}>
    <p>Archive <strong>{notice.content.title}</strong> for {notice.propertyName}? The notice stays in your archive and disappears from the resident board.</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <div className="admin-actions">
      <button className="admin-secondary" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="admin-primary" disabled={busy} onClick={async () => {
        setBusy(true)
        setError('')
        try {
          await api(ownerAnnouncements + '/' + notice.id + '/archive', { version: notice.version })
          onSaved('Announcement archived.')
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Could not archive the announcement. Try again.')
        } finally {
          setBusy(false)
        }
      }}>{busy ? 'Archiving…' : 'Confirm archive'}</button>
    </div>
  </ResidentDialog>
}
