import { useEffect, useState } from 'react'
import { liveFallback, workspaceStorageKey } from './workspaceSession'

export const PREVIEW_EVENT = 'haruhay-preview-updated'

export function readPreview<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(workspaceStorageKey(key)) ?? 'null')
    return valid(value) ? value : liveFallback(key, fallback)
  } catch { return liveFallback(key, fallback) }
}

export function savePreview(key: string, value: unknown) {
  try { sessionStorage.setItem(workspaceStorageKey(key), JSON.stringify(value)) }
  catch { throw new Error('Could not save. Allow browser storage and try again; your changes have not been saved.') }
  window.dispatchEvent(new Event(PREVIEW_EVENT))
}

export function usePreviewData<T>(read: () => T): T {
  const [value, setValue] = useState(read)
  useEffect(() => {
    const update = () => setValue(read())
    const events = [PREVIEW_EVENT, 'haruhay-profile-updated', 'haruhay-holding-updated', 'haruhay-workspace-changed', 'storage']
    events.forEach(event => window.addEventListener(event, update))
    return () => events.forEach(event => window.removeEventListener(event, update))
  }, [read])
  return value
}

export function downloadCsv(filename: string, rows: string[][]) {
  const cell = (value: string) => {
    // Prevent user-entered cells from being evaluated as spreadsheet formulas.
    const safe = /^[\t\r\n]/u.test(value) || /^[=+@\-＝＋＠－]/u.test(value.trimStart()) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  downloadBlob(filename, new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function manilaInputDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return parts.replace(' ', 'T')
}
