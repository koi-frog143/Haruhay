import { useEffect, useState } from 'react'

export const PREVIEW_EVENT = 'haruhay-preview-updated'

export function readPreview<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return valid(value) ? value : fallback
  } catch { return fallback }
}

export function savePreview(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) }
  catch { throw new Error('Could not save. Allow browser storage and try again; your changes have not been saved.') }
  window.dispatchEvent(new Event(PREVIEW_EVENT))
}

export function usePreviewData<T>(read: () => T): T {
  const [value, setValue] = useState(read)
  useEffect(() => {
    const update = () => setValue(read())
    const events = [PREVIEW_EVENT, 'haruhay-profile-updated', 'haruhay-holding-updated', 'storage']
    events.forEach(event => window.addEventListener(event, update))
    return () => events.forEach(event => window.removeEventListener(event, update))
  }, [read])
  return value
}

export function downloadCsv(filename: string, rows: string[][]) {
  const cell = (value: string) => {
    // Prevent user-entered cells from being evaluated as spreadsheet formulas.
    const safe = /^[=+@\-\t\r]/u.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
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
