import type { ReactNode } from 'react'
import AdminLayout from './AdminLayout'
import ResidentLayout from './ResidentLayout'

export default function HoldingWorkspace({ admin, desk, notice, onNotice, onDismissNotice, children }: { admin: boolean; desk: boolean; notice: string; onNotice: (message: string) => void; onDismissNotice: () => void; children: ReactNode }) {
  return admin ? <AdminLayout active="Holding station" node="18:2419" notice={notice} onDismissNotice={onDismissNotice}>{children}</AdminLayout> : <ResidentLayout activeSection="Holding station" breadcrumb={desk ? 'Holding station / Front desk' : 'Holding station'} notice={notice} onNotice={onNotice} onDismissNotice={onDismissNotice}>{children}</ResidentLayout>
}
