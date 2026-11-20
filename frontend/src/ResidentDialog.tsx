import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import './ResidentInteractions.css'

type Props = { title: string; eyebrow: string; onClose: () => void; children: ReactNode }

export default function ResidentDialog({ title, eyebrow, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = opener.current
    element?.showModal()
    return () => {
      element?.close()
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]')) previous.focus()
        else document.querySelector<HTMLElement>('.resident-menu-button, .admin-menu-button')?.focus()
      })
    }
  }, [])
  return <dialog ref={dialog} className="resident-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')).filter(element => element.getClientRects().length)
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog">×</button></header>
    <p className="dialog-eyebrow">{eyebrow}</p>
    {children}
    <p className="dialog-preview" id={descriptionId}>Frontend preview · changes stay in this browser session.</p>
  </dialog>
}
