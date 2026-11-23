import { useEffect, useRef, useState } from 'react'
import { api } from './registrationApi'
import { philippineTime } from './visitorApi'
import type { GuestPass } from './visitorApi'
import logo from './landing-artwork.json'
import './LiveLogbook.css'

export function VisitorPassCard({ pass }: { pass: GuestPass }) {
  const [image, setImage] = useState<{ token: string; url: string }>()
  const [failed, setFailed] = useState(false)
  const token = pass.token
  useEffect(() => {
    let active = true
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(token, { scale: 8, errorCorrectionLevel: 'M', margin: 4 }),
    ).then(url => { if (active) setImage({ token, url }) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [token])
  return <div className="visitor-pass">
    {image?.token === token ? <img src={image.url} width="256" height="256" alt="Haruhay visitor QR pass" />
      : <p role={failed ? 'alert' : 'status'}>{failed ? 'Unable to display the QR. Reload this page or ask the front desk to find your visit.' : 'Loading QR code…'}</p>}
    <h2>{pass.propertyName}</h2>
    <p className="visitor-muted">Philippine time</p>
    <dl className="visitor-pass-window">
      <div><dt>{pass.entryWindowEnded ? 'Entry window ended' : 'Valid for entry from'}</dt><dd>{philippineTime(pass.entryWindowEnded ? pass.expiresAt : pass.startsAt)}</dd></div>
      {!pass.entryWindowEnded && <div><dt>Valid until</dt><dd>{philippineTime(pass.expiresAt)}</dd></div>}
    </dl>
    <p>Show this pass and your ID at the front desk.</p>
  </div>
}

export function ShareVisitorLink({ url }: { url: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setNotice('Private link copied.')
    } catch {
      input.current?.focus()
      input.current?.select()
      setNotice('Link selected. Use your device’s copy command.')
    }
  }
  async function shareLink() {
    try {
      await navigator.share({ title: 'Haruhay visitor pass', url })
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') await copyLink()
    }
  }
  return <div className="visitor-form visitor-share">
    <label>Private guest link<input ref={input} readOnly value={url} onFocus={event => event.target.select()} /></label>
    <div className="visitor-actions">
      {typeof navigator.share === 'function' && <button className="admin-primary" onClick={() => void shareLink()}>Share link</button>}
      <button className="admin-secondary" onClick={() => void copyLink()}>Copy link</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </div>
}

export default function GuestVisitorPass({ shareToken }: { shareToken: string }) {
  const [pass, setPass] = useState<GuestPass>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Visitor pass | Haruhay'
    return () => { document.title = previousTitle }
  }, [])
  useEffect(() => {
    let active = true
    api<GuestPass>('/public/visitor-pass', { token: shareToken }).then(result => {
      if (active) setPass(result)
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Unable to load the pass. Check your connection and try again.')
    })
    return () => { active = false }
  }, [shareToken, retry])

  return <main className="visitor-guest-page">
    <header><img src={logo.HaruhayFinalWebFallbackMark} alt="" width="40" height="40" /><strong>Haruhay</strong></header>
    <section className="visitor-card" aria-labelledby="guest-pass-title">
      <h1 id="guest-pass-title" className="visually-hidden">Visitor pass</h1>
      {pass ? <VisitorPassCard pass={pass} /> : error
        ? <><h2>Pass unavailable</h2><p role="alert">{error}</p><button className="admin-secondary" onClick={() => { setError(''); setRetry(attempt => attempt + 1) }}>Try again</button></>
        : <p role="status">Opening your visitor pass…</p>}
    </section>
  </main>
}
