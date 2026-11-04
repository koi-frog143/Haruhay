import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import { getResidentProfile } from './profileData'
import { CURRENT_RESIDENT, HOLDING_CATEGORIES, HOLDING_RESIDENTS, HOLDING_SLOTS, getHoldingState, holdingCode, holdingNow, saveHoldingState, useHoldingState } from './holdingData'
import type { HoldingItem, HoldingState, ResidentId } from './holdingData'
import './HoldingStation.css'

type Tab = 'records' | 'record' | 'inquiry'
type Modal = { mode: 'pickup' | 'details' | 'edit' | 'release' | 'delete'; id: number } | { mode: 'all' | 'history' }
type Visitor = { name: string; idNumber: string }
const asset = (name: string) => './assets/dashboard/' + name

function residentName(id: ResidentId) {
  return id === CURRENT_RESIDENT ? getResidentProfile().fullName : HOLDING_RESIDENTS[id].name
}
function value(data: FormData, key: string) { return String(data.get(key) ?? '').trim() }
function Status({ item }: { item: HoldingItem }) {
  return <span className={'hs-tag ' + (item.status === 'Ready' ? 'hs-ready' : 'hs-collected')}>{item.status === 'Ready' ? 'Ready for pickup' : 'Collected'}</span>
}

export default function HoldingStation({ desk = false }: { desk?: boolean }) {
  const state = useHoldingState()
  const [tab, setTab] = useState<Tab>('records')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [dark, setDark] = useState(false)
  const [modal, setModal] = useState<Modal | null>(null)
  const [matches, setMatches] = useState<number[] | null>(null)
  const [visitor, setVisitor] = useState<Visitor | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const selected = modal && 'id' in modal ? state.items.find(item => item.id === modal.id) : undefined
  const mine = state.items.filter(item => item.residentId === CURRENT_RESIDENT)
  const ready = mine.filter(item => item.status === 'Ready')
  const collected = mine.filter(item => item.status === 'Claimed').slice().reverse()
  const held = state.items.filter(item => item.status === 'Ready').length
  const occupied = state.items.filter(item => item.status === 'Ready').map(item => item.slot)
  const visible = state.items.filter(item => (filter === 'all' || item.status === filter) &&
    [item.code, item.description, residentName(item.residentId), item.tracking, HOLDING_RESIDENTS[item.residentId].room, item.slot].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const matchItems = state.items.filter(item => matches?.includes(item.id) && item.status === 'Ready')

  useEffect(() => { document.title = (desk ? 'Front desk holding station' : 'Holding station') + ' | Haruhay' }, [desk])
  useEffect(() => {
    if (modal) dialog.current?.showModal()
    else dialog.current?.close()
  }, [modal])

  function open(next: Modal) { setError(''); setModal(next) }
  function commit(next: HoldingState, message: string) {
    try {
      saveHoldingState(next)
      setNotice(message)
      return true
    } catch {
      setError('Your changes could not be saved. Enable browser session storage and try again.')
      return false
    }
  }

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const data = new FormData(event.currentTarget)
    const current = getHoldingState()
    const residentId = value(data, 'residentId') as ResidentId
    const description = value(data, 'description')
    const slot = value(data, 'slot')
    if (!Object.hasOwn(HOLDING_RESIDENTS, residentId) || !description) { setError('Select a resident and describe the item.'); return }
    if (!HOLDING_SLOTS.includes(slot) || current.items.some(item => item.status === 'Ready' && item.slot === slot)) { setError('Choose an available storage slot.'); return }
    const random = crypto.getRandomValues(new Uint32Array(1))[0]
    const received = holdingNow()
    const item: HoldingItem = {
      id: current.nextId, code: holdingCode(current.nextId), residentId, description, slot, received,
      category: value(data, 'category'), depositor: value(data, 'depositor'), sender: value(data, 'sender'), tracking: value(data, 'tracking'),
      pin: String(100000 + random % 900000), status: 'Ready', history: ['Received • ' + received + ' • Shelf ' + slot],
    }
    if (commit({ ...current, nextId: current.nextId + 1, items: [item, ...current.items] }, item.code + ' saved. Ready for pickup.')) { setTab('records'); setQuery(''); setFilter('all') }
  }

  function searchInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const data = new FormData(event.currentTarget)
    const name = value(data, 'visitorName')
    const idNumber = value(data, 'idNumber')
    const residentId = value(data, 'residentId')
    const tracking = value(data, 'tracking')
    if (!name || !idNumber || (!residentId && !tracking)) { setError('Enter the visitor’s name, ID number, and a resident or tracking number.'); return }
    const current = getHoldingState()
    const found = current.items.filter(item => item.status === 'Ready' &&
      (!residentId || item.residentId === residentId) && (!tracking || item.tracking.toLowerCase() === tracking.toLowerCase()))
    const inquiry = {
      id: crypto.randomUUID(), time: holdingNow(), name, identity: value(data, 'idType') + ' • ' + idNumber,
      lookingFor: residentId ? residentName(residentId as ResidentId) + (tracking ? ' • ' + tracking : '') : tracking,
      purpose: value(data, 'purpose'), result: found.length ? found.length + ' match' + (found.length === 1 ? '' : 'es') : 'No match',
    }
    if (commit({ ...current, inquiries: [inquiry, ...current.inquiries] }, 'Inquiry logged.')) {
      setMatches(found.map(item => item.id))
      setVisitor({ name, idNumber })
    }
  }

  function saveModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!selected || !modal) return
    const data = new FormData(event.currentTarget)
    const current = getHoldingState()
    const item = current.items.find(entry => entry.id === selected.id)
    if (!item) { setError('This item is no longer available. Close this dialog and refresh the records.'); return }
    let updated: HoldingItem = { ...item, history: [...item.history] }
    let message = 'Record updated.'
    if (modal.mode === 'edit') {
      const description = value(data, 'description')
      const slot = value(data, 'slot')
      if (!description) { setError('Description is required.'); return }
      if (!HOLDING_SLOTS.includes(slot) || (item.status === 'Ready' && current.items.some(other => other.id !== item.id && other.status === 'Ready' && other.slot === slot))) {
        setError('Choose an available storage slot.'); return
      }
      updated = { ...updated, description, slot }
      if (slot !== item.slot) updated.history.push('Shelf changed ' + item.slot + ' → ' + slot + ' • ' + holdingNow())
      if (description !== item.description) updated.history.push('Description updated • ' + holdingNow())
    } else if (modal.mode === 'release') {
      if (item.status !== 'Ready') { setError('This item has already been collected.'); return }
      const identity = value(data, 'idNumber')
      const claimant = value(data, 'claimedBy')
      const relationship = value(data, 'relationship')
      if (!identity || !claimant) { setError('Enter the claimant’s name and presented ID.'); return }
      if (relationship === 'Owner' && identity.toUpperCase() !== item.residentId) {
        const denied = { ...item, history: [...item.history, 'Claim denied: ID mismatch • ' + holdingNow()] }
        if (commit({ ...current, items: current.items.map(entry => entry.id === item.id ? denied : entry) }, 'Claim denied: ID did not match.')) setError('The presented ID does not match this resident’s ID.')
        return
      }
      if (relationship === 'Authorized representative' && !data.has('authorized')) { setError('Check the owner’s authorization before releasing to a representative.'); return }
      if (!data.has('signed')) { setError('The claimant must confirm receipt.'); return }
      updated = { ...updated, status: 'Claimed', claimed: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date()) }
      updated.history.push('Collected • ' + holdingNow() + ' • Released to ' + claimant + ' (' + relationship + ', ID ' + identity + ')')
      message = 'Item released to ' + claimant + '.'
    } else if (modal.mode === 'delete') {
      if (commit({ ...current, items: current.items.filter(entry => entry.id !== item.id) }, 'Record deleted.')) setModal(null)
      return
    }
    if (commit({ ...current, items: current.items.map(entry => entry.id === updated.id ? updated : entry) }, message)) { setModal(null); setVisitor(null) }
  }

  function pickupCard(item: HoldingItem) {
    const isLetter = item.category === 'Letter / document'
    return <article className="hs-card hs-pickup-card" key={item.id}>
      <h3>{item.description}</h3>
      <p className="hs-meta"><img src={asset(isLetter ? 'holding-file.svg' : 'holding-box-card.svg')} width={isLetter ? 34 : 38} height={isLetter ? 34 : 38} alt="" /><span>Received {item.received}</span></p>
      <div className="hs-card-footer"><span className="hs-tag">Shelf {item.slot}</span><button className="hs-button" type="button" onClick={() => open({ mode: 'pickup', id: item.id })}>View pickup details</button></div>
    </article>
  }

  return <ResidentLayout activeSection="Holding station" breadcrumb={desk ? 'Holding station / Front desk' : 'Holding station'} notice={notice} onNotice={setNotice} onDismissNotice={() => setNotice('')}>
    <div className={'resident-content hs-content' + (dark ? ' hs-dark' : '')}>
      <header className="resident-page-heading hs-heading">
        <div><span>{desk ? 'FRONT DESK' : 'YOUR DELIVERIES'}</span><h1>Holding station</h1><p>{desk ? 'Record, track and release held items, and handle walk-in inquiries.' : 'Every item is kept safely until you are ready to collect.'}</p></div>
        <div className="hs-view-controls">
          <nav aria-label="Holding station workspace"><a href="#/resident/holding-station" aria-current={!desk ? 'page' : undefined}>Resident</a><a href="#/front-desk/holding-station" aria-current={desk ? 'page' : undefined}>Front desk</a></nav>
          <button className="hs-button" type="button" aria-pressed={dark} onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'}</button>
        </div>
      </header>
      {desk && <p className="hs-preview-note">Front desk preview • Changes are kept in this browser session. Staff sign-in and notifications are not connected yet.</p>}
      <section className="hs-hero" aria-label="Holding station summary">
        <img src={asset('holding-box-hero.svg')} width="39" height="39" alt="" />
        <div><h2>{desk ? held + ' item' + (held === 1 ? '' : 's') + ' held at the station' : ready.length ? ready.length + (ready.length === 1 ? ' package is' : ' packages are') + ' ready for you' : 'Nothing waiting right now'}</h2>
          <p>{desk ? (state.items.length - held) + ' collected • ' + state.inquiries.length + ' walk-in inquiries logged' : 'Please show your resident ID or pickup code at the front desk.'}</p>
          <span className="hs-hero-badge">{desk ? 'VERIFY ID BEFORE RELEASE' : 'PICKUP • FRONT DESK'}</span>
        </div>
        <img className="hs-stars" src={asset('holding-stars.svg')} width="97" height="120.28" alt="" />
      </section>

      {!desk ? <>
        <section aria-labelledby="hs-ready-title">
          <div className="hs-section-heading"><h2 id="hs-ready-title">Ready for pickup</h2><button type="button" onClick={() => open({ mode: 'all' })}>View all <span aria-hidden="true">→</span></button></div>
          <div className="hs-pickup-grid">{ready.length ? ready.slice(0, 2).map(pickupCard) : <p className="hs-empty">No items to collect. Your next delivery will appear here.</p>}</div>
        </section>
        <section aria-labelledby="hs-collected-title">
          <div className="hs-section-heading hs-history-heading"><h2 id="hs-collected-title">Recently collected</h2><button type="button" onClick={() => open({ mode: 'history' })}>History <span aria-hidden="true">→</span></button></div>
          {collected.length ? collected.slice(0, 3).map(item => <article className="hs-card hs-collected-card" key={item.id}><div><h3>{item.description}</h3><span className="hs-tag hs-collected">Collected {item.claimed}</span></div><p>{item.code} • Room {HOLDING_RESIDENTS[item.residentId].room} • Front desk</p></article>) : <p className="hs-empty">Nothing collected yet.</p>}
        </section>
      </> : <>
        <nav className="hs-tabs" aria-label="Front desk sections">{([['records', 'Holding records'], ['record', 'Record held item'], ['inquiry', 'Walk-in inquiries']] as const).map(([id, title]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setError('') }}>{title}</button>)}</nav>
        {error && !modal && <p className="hs-error" role="alert">{error}</p>}
        {tab === 'records' && <>
          <div className="hs-toolbar"><label><span className="hs-sr-only">Search holding records</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, item, resident or tracking number" /></label><label><span className="hs-sr-only">Filter by status</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option><option value="Ready">Ready for pickup</option><option value="Claimed">Collected</option></select></label><button type="button" className="hs-button hs-primary" onClick={() => { setTab('record'); setError('') }}>Record held item</button></div>
          <div className="hs-table-wrap"><table className="hs-table"><caption className="hs-sr-only">Holding station records</caption><thead><tr><th>Item</th><th>Held for</th><th>Shelf</th><th>Received</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {visible.map(item => <tr key={item.id}><th scope="row">{item.description}<small>{item.code}{item.tracking && ' • ' + item.tracking}</small></th><td>{residentName(item.residentId)}<small>Room {HOLDING_RESIDENTS[item.residentId].room}</small></td><td>{item.slot}</td><td>{item.received}</td><td><Status item={item} /></td><td><div className="hs-actions">{item.status === 'Ready' && <button className="hs-button hs-primary" type="button" onClick={() => { setVisitor(null); open({ mode: 'release', id: item.id }) }}>Release</button>}<button className="hs-button" type="button" onClick={() => open({ mode: 'details', id: item.id })}>Details</button><button className="hs-button" type="button" onClick={() => open({ mode: 'edit', id: item.id })}>Edit</button><button className="hs-button hs-danger" type="button" onClick={() => open({ mode: 'delete', id: item.id })}>Delete</button></div></td></tr>)}
            {!visible.length && <tr><td colSpan={6} className="hs-empty">No records match your search and status filter.</td></tr>}
          </tbody></table></div>
        </>}
        {tab === 'record' && <section className="hs-card"><h2>Record a held item</h2><p className="hs-subtitle">Keep the delivery details and storage location together.</p><form className="hs-form" onSubmit={addItem}>
          <label>Held for (resident)<select name="residentId" required defaultValue=""><option value="" disabled>Select resident</option>{Object.entries(HOLDING_RESIDENTS).map(([id, resident]) => <option key={id} value={id}>{residentName(id as ResidentId)} • Room {resident.room}</option>)}</select></label>
          <label>Category<select name="category">{HOLDING_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
          <label className="hs-full">Item description<input name="description" placeholder="e.g. Shopee parcel, medium box" maxLength={150} required /></label>
          <label>Dropped off by<select name="depositor"><option>Courier / sender</option><option>Visitor</option><option>Resident</option></select></label>
          <label>Sender / carrier name<input name="sender" maxLength={100} /></label>
          <label>Tracking number (optional)<input name="tracking" maxLength={100} /></label>
          <label>Storage slot<select name="slot" required defaultValue=""><option value="" disabled>Select an available shelf</option>{HOLDING_SLOTS.map(slot => <option key={slot} value={slot} disabled={occupied.includes(slot)}>{slot}{occupied.includes(slot) ? ' (occupied)' : ''}</option>)}</select></label>
          {occupied.length >= HOLDING_SLOTS.length && <p className="hs-warning hs-full">All shelves are occupied. Release an item before recording another delivery.</p>}
          <div className="hs-actions hs-full hs-form-actions"><button type="button" className="hs-button" onClick={() => setTab('records')}>Cancel</button><button className="hs-button hs-primary" type="submit" disabled={occupied.length >= HOLDING_SLOTS.length}>Save holding record</button></div>
        </form></section>}
        {tab === 'inquiry' && <>
          <section className="hs-card"><h2>Walk-in inquiry</h2><p className="hs-subtitle">Record the visitor’s details and look for a held item.</p><form className="hs-form" onSubmit={searchInquiry}>
            <label>Visitor name<input name="visitorName" maxLength={100} required /></label><label>ID type<select name="idType"><option>Student ID</option><option>Driver’s license</option><option>UMID</option><option>National ID</option></select></label>
            <label>ID number<input name="idNumber" maxLength={60} required /></label><label>Purpose<select name="purpose"><option>Pick up item</option><option>Ask about a delivery</option></select></label>
            <label>Looking for (resident)<select name="residentId" defaultValue=""><option value="">Not sure</option>{Object.keys(HOLDING_RESIDENTS).map(id => <option value={id} key={id}>{residentName(id as ResidentId)}</option>)}</select></label>
            <label>Tracking number<input name="tracking" placeholder="Optional when resident is selected" maxLength={100} /></label>
            <div className="hs-actions hs-full hs-form-actions"><button type="submit" className="hs-button hs-primary">Search holding records</button></div>
          </form></section>
          {matches !== null && <section aria-label="Inquiry results" aria-live="polite"><p className={matchItems.length ? 'hs-success' : 'hs-warning'}>{matchItems.length ? matchItems.length + ' matching item' + (matchItems.length === 1 ? '' : 's') + ' ready for pickup.' : 'No matching items are ready for pickup. Check the resident or tracking number.'}</p>{matchItems.map(item => <article className="hs-card hs-match" key={item.id}><div><h3>{item.description}</h3><p>{item.code} • {residentName(item.residentId)} • Room {HOLDING_RESIDENTS[item.residentId].room} • Shelf {item.slot}</p></div><button className="hs-button hs-primary" type="button" onClick={() => open({ mode: 'release', id: item.id })}>Release</button></article>)}</section>}
          <div className="hs-section-heading"><h2>Inquiry log</h2></div><div className="hs-table-wrap"><table className="hs-table"><caption className="hs-sr-only">Walk-in inquiry log</caption><thead><tr><th>Time</th><th>Visitor</th><th>ID</th><th>Looking for</th><th>Purpose</th><th>Result</th></tr></thead><tbody>{state.inquiries.map(entry => <tr key={entry.id}><td>{entry.time}</td><td>{entry.name}</td><td>{entry.identity}</td><td>{entry.lookingFor}</td><td>{entry.purpose}</td><td>{entry.result}</td></tr>)}{!state.inquiries.length && <tr><td colSpan={6} className="hs-empty">No inquiries yet.</td></tr>}</tbody></table></div>
        </>}
      </>}
      <dialog ref={dialog} className="hs-dialog" aria-labelledby="hs-dialog-title" onClose={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null) }}>
        {modal && <><div className="hs-dialog-heading"><h2 id="hs-dialog-title">{modal.mode === 'all' ? 'All items ready for pickup' : modal.mode === 'history' ? 'Collection history' : modal.mode === 'delete' ? 'Delete this record?' : modal.mode === 'release' ? 'Release held item' : modal.mode === 'edit' ? 'Edit holding record' : modal.mode === 'pickup' ? 'Pickup details' : 'Holding record details'}</h2><button type="button" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></div>
          {error && <p className="hs-error" role="alert">{error}</p>}
          {(modal.mode === 'all' || modal.mode === 'history') && <div className="hs-dialog-list">{(modal.mode === 'all' ? ready : collected).map(item => <article key={item.id} className="hs-list-item"><h3>{item.description}</h3><p>{item.code} • Shelf {item.slot}</p><p>{modal.mode === 'all' ? 'Received ' + item.received : 'Collected ' + item.claimed}</p><button className="hs-button" type="button" onClick={() => open({ mode: modal.mode === 'all' ? 'pickup' : 'details', id: item.id })}>View details</button></article>)}{!(modal.mode === 'all' ? ready : collected).length && <p className="hs-empty">No items to show.</p>}</div>}
          {selected && <>
            <h3 className="hs-dialog-item">{selected.description}</h3><p className="hs-subtitle">{selected.code} • Shelf {selected.slot} • Room {HOLDING_RESIDENTS[selected.residentId].room}</p>
            {modal.mode === 'pickup' && <><p>Show this pickup code or your resident ID at the front desk.</p><div className="hs-pickup-code" aria-label={'Pickup code ' + selected.pin}>{selected.pin}</div><p className="hs-subtitle">Received {selected.received}{selected.sender && ' • From ' + selected.sender}</p></>}
            {modal.mode === 'details' && <><dl className="hs-detail-list"><div><dt>Held for</dt><dd>{residentName(selected.residentId)}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Dropped off by</dt><dd>{selected.sender || 'Not provided'} • {selected.depositor}</dd></div><div><dt>Tracking number</dt><dd>{selected.tracking || 'Not provided'}</dd></div><div><dt>Status</dt><dd><Status item={selected} /></dd></div></dl><h3>Status history</h3><ul className="hs-log">{selected.history.map((line, index) => <li key={index}>{line}</li>)}</ul></>}
            {(modal.mode === 'edit' || modal.mode === 'release' || modal.mode === 'delete') && <form className="hs-form hs-modal-form" key={modal.mode + selected.id} onSubmit={saveModal}>
              {modal.mode === 'edit' && <><label>Item description<input name="description" defaultValue={selected.description} maxLength={150} required /></label><label>Storage slot<select name="slot" defaultValue={selected.slot} required>{HOLDING_SLOTS.map(slot => <option value={slot} key={slot} disabled={selected.status === 'Ready' && slot !== selected.slot && occupied.includes(slot)}>{slot}{selected.status === 'Ready' && slot !== selected.slot && occupied.includes(slot) ? ' (occupied)' : ''}</option>)}</select></label></>}
              {modal.mode === 'release' && <><label>ID number presented<input name="idNumber" defaultValue={visitor?.idNumber ?? ''} placeholder={'e.g. ' + selected.residentId} maxLength={60} required /></label><label>Claimed by<input name="claimedBy" defaultValue={visitor?.name ?? residentName(selected.residentId)} maxLength={100} required /></label><label>Relationship to owner<select name="relationship"><option>Owner</option><option>Authorized representative</option></select></label><label className="hs-checkbox"><input name="authorized" type="checkbox" />Owner’s authorization checked (required for a representative)</label><label className="hs-checkbox"><input name="signed" type="checkbox" required />Claimant signed / confirmed receipt</label><p className="hs-warning">Sample resident ID: {selected.residentId}. Verify identity before confirming release.</p></>}
              {modal.mode === 'delete' && <p>This removes the holding record and its history from this browser session. This action cannot be undone.</p>}
              <div className="hs-actions hs-form-actions"><button type="button" className="hs-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className={'hs-button ' + (modal.mode === 'delete' ? 'hs-delete' : 'hs-primary')}>{modal.mode === 'edit' ? 'Save changes' : modal.mode === 'release' ? 'Confirm release' : 'Delete record'}</button></div>
            </form>}
          </>}
          {(modal.mode === 'all' || modal.mode === 'history' || modal.mode === 'pickup' || modal.mode === 'details') && <div className="hs-actions hs-form-actions"><button className="hs-button hs-primary" type="button" onClick={() => setModal(null)}>Done</button></div>}
        </>}
      </dialog>
    </div>
  </ResidentLayout>
}

