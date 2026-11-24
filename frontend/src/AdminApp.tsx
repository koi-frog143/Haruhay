import RegistrationFlow from './RegistrationFlow'
import AdminLayout from './AdminLayout'
import { AdminEmpty } from './AdminUI'
import { AdminAnnouncements, AdminBilling, AdminDashboard, AdminLogbook, AdminMaintenance, AdminMaintenanceDetails, AdminPayments, AdminResidentDetails, AdminResidents } from './AdminPages'
import AdminSettings from './AdminSettings'
import HoldingStation from './HoldingStation'
import LiveLogbook from './LiveLogbook'
import LiveMaintenance from './LiveMaintenance'
import { isLiveWorkspace } from './workspaceSession'

export default function AdminApp() {
  const hash = window.location.hash.slice(1)
  const [path, query = ''] = hash.split('?')
  const residentId = new URLSearchParams(query).get('resident') ?? ''
  const recordId = (prefix: string) => { try { return decodeURIComponent(path.slice(prefix.length)) } catch { return '' } }
  if (path === '/admin/applications') return <RegistrationFlow />
  if (path === '/admin/property') return <RegistrationFlow />
  if (path === '/admin' || path === '/admin/' || path === '/admin/dashboard') return <AdminDashboard />
  if (path === '/admin/residents') return <AdminResidents />
  if (path.startsWith('/admin/residents/')) return <AdminResidentDetails id={recordId('/admin/residents/')} />
  if (path === '/admin/logbook') return isLiveWorkspace() ? <LiveLogbook staff residentId={residentId} /> : <AdminLogbook residentId={residentId} />
  if (path === '/admin/maintenance') return isLiveWorkspace() ? <LiveMaintenance role="owner" /> : <AdminMaintenance />
  if (path.startsWith('/admin/maintenance/')) return isLiveWorkspace()
    ? <LiveMaintenance role="owner" id={recordId('/admin/maintenance/')} />
    : <AdminMaintenanceDetails id={recordId('/admin/maintenance/')} />
  if (path === '/admin/holding-station') return <HoldingStation admin desk />
  if (path === '/admin/billing') return <AdminBilling />
  if (path === '/admin/payments/approvals') return <AdminPayments residentId={residentId} />
  if (path === '/admin/announcements') return <AdminAnnouncements />
  if (path === '/admin/settings') return <AdminSettings />
  return <AdminLayout active="Dashboard" node="18:1676"><AdminEmpty title="Admin page not found">Choose an admin section from the navigation.</AdminEmpty></AdminLayout>
}
