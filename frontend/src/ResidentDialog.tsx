import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './ResidentInteractions.css'

type Props = {
  dismissOnBackdrop?: boolean
  preserveDraftOnClose?: boolean
  protectEdits?: boolean
  busy?: boolean
  className?: string
  footerNote?: string
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
}

export default function ResidentDialog({ title, eyebrow, onClose, children, footerNote, dismissOnBackdrop = true, preserveDraftOnClose = false, protectEdits = true, busy = false, className = '' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const titleElement = useRef<HTMLHeadingElement>(null)
  const edited = useRef(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = opener.current
    element?.showModal()
    titleElement.current?.focus({ preventScroll: true })
    return () => {
      element?.close()
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]')) previous.focus()
        else {
          const menu = document.querySelector<HTMLElement>('.resident-menu-button, .admin-menu-button')
          if (menu?.getClientRects().length) menu.focus()
          else document.querySelector<HTMLElement>('#resident-main, #admin-main, .guard-header button')?.focus()
        }
      })
    }
  }, [])
  const note = footerNote ?? 'Changes here are saved in this browser session.'
  function markEdited(target: EventTarget) {
    if (protectEdits && target instanceof HTMLElement && target.closest('form')) edited.current = true
  }
  function requestClose() {
    if (busy) return
    if (confirmDiscard) { setConfirmDiscard(false); return }
    if (edited.current && !preserveDraftOnClose) { setConfirmDiscard(true); return }
    onClose()
  }
  return <dialog ref={dialog} className={`resident-dialog ux-dialog ${className}`} aria-labelledby={titleId} aria-describedby={note ? descriptionId : undefined} onCancel={event => { event.preventDefault(); requestClose() }} onClick={event => { if (dismissOnBackdrop && !edited.current && event.target === event.currentTarget) requestClose() }} onInputCapture={event => markEdited(event.target)} onChangeCapture={event => markEdited(event.target)} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary')).filter(element => element.getClientRects().length && !element.closest('[inert]'))
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleElement.current)) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <header className="ux-dialog-header"><h2 id={titleId} ref={titleElement} tabIndex={-1}>{title}</h2><button type="button" disabled={busy} onClick={requestClose} aria-label="Close dialog">×</button></header>
    <div className="ux-dialog-body">
      {confirmDiscard && <div className="ux-status ux-discard" data-tone="warning">
        <p role="alert">You have unsaved changes. Keep editing or discard them.</p>
        <button type="button" className="admin-primary" ref={element => { element?.focus() }} onClick={() => { setConfirmDiscard(false); titleElement.current?.focus() }}>Keep editing</button>
        <button type="button" className="admin-secondary" onClick={onClose}>Discard changes</button>
      </div>}
      <div inert={confirmDiscard}>
        {eyebrow && <p className="dialog-eyebrow">{eyebrow}</p>}
        {children}
        {note && <p className="dialog-preview" id={descriptionId}>{note}</p>}
      </div>
    </div>
  </dialog>
}
