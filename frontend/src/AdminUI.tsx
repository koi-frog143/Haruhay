import type { ReactNode } from 'react'
import artwork from './admin-artwork.json'
import './Admin.css'

export function AdminIcon({ node = '18:1676', name, className = '' }: { node?: string; name: string; className?: string }) {
  const asset = (artwork as Record<string, Record<string, { src: string; width: number; height: number }>>)[node]?.[name]
  if (!asset) throw new Error(`Missing admin artwork: ${node} / ${name}`)
  const width = name === 'imgHaruhayFinalWebFallbackMark' ? 56 : name === 'imgHaruhayFinalWebFallbackWordmark' ? 172 : asset.width
  const height = name === 'imgHaruhayFinalWebFallbackMark' ? 56 : name === 'imgHaruhayFinalWebFallbackWordmark' ? 46 : asset.height
  return <img src={asset.src} width={width} height={height} className={className} alt="" />
}
export function AdminHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="admin-heading"><div><span>{eyebrow}</span><h1 tabIndex={-1}>{title}</h1><p>{description}</p></div>{action}</header>
}
export function AdminMetrics({ items, node }: { node: string; items: Array<{ label: string; value: string | number; icon: string; tone?: string; href?: string }> }) {
  return <section className="admin-metrics" aria-label="Overview metrics">{items.map(item => {
    const content = <><span className={`admin-metric-icon ${item.tone ?? ''}`}><AdminIcon node={node} name={item.icon} /></span><strong>{item.value}</strong><span>{item.label}</span></>
    return item.href ? <a className="admin-metric" key={item.label} href={item.href}>{content}</a> : <article className="admin-metric" key={item.label}>{content}</article>
  })}</section>
}
export function AdminTable({ columns, rows, empty = 'No records match the current filters.' }: { columns: string[]; rows: Array<{ key: string; cells: ReactNode[] }>; empty?: string }) {
  return <div className="admin-table-wrap"><table className="admin-table"><caption className="visually-hidden">{columns.join(', ')}</caption><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{rows.length ? rows.map(row => <tr key={row.key}>{row.cells.map((cell, index) => index === 0 ? <th scope="row" data-label={columns[index]} key={index}>{cell}</th> : <td data-label={columns[index]} key={index}>{cell}</td>)}</tr>) : <tr><td colSpan={columns.length} className="admin-empty">{empty}</td></tr>}</tbody></table></div>
}
export function AdminStatus({ children }: { children: ReactNode }) { return <span className={'admin-status status-' + String(children).toLowerCase().replace(/[^a-z0-9]+/gu, '-')}>{children}</span> }
export function AdminEmpty({ title = 'Record not found', children }: { title?: string; children?: ReactNode }) { return <section className="admin-panel"><h1>{title}</h1><p>{children ?? 'This record is not available in this preview session.'}</p><a href="#/admin/dashboard">Back to admin dashboard</a></section> }
