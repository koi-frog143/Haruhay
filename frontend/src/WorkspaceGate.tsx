import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from './registrationApi'
import { hasActiveStay, hasEndedStay, hasPendingApplication, isSampleWorkspace, loadWorkspaceSession } from './workspaceSession'

export type WorkspaceKind = 'account' | 'admin' | 'resident' | 'resident-billing' | 'guard' | 'technician'

export default function WorkspaceGate({ kind, children }: { kind: WorkspaceKind; children: ReactNode }) {
  const sample = isSampleWorkspace() && kind !== 'account' && kind !== 'guard' && kind !== 'technician'
  const [state, setState] = useState(sample ? 'ready' : 'loading')
  const [error, setError] = useState('')
  useEffect(() => {
    if (sample) return
    let active = true
    loadWorkspaceSession().then(s => {
      if (!active) return
      if (s.account.role === 'GUARD' && kind !== 'guard') { window.location.replace('#/guard/logbook'); return }
      if (s.account.role === 'TECHNICIAN' && kind !== 'technician') { window.location.replace('#/technician/jobs'); return }
      if (kind === 'technician' && s.account.role !== 'TECHNICIAN') { window.location.replace(s.account.role === 'OWNER' ? '#/admin/maintenance' : '#/account/status'); return }
      if (kind === 'guard' && s.account.role !== 'GUARD') { window.location.replace(s.account.role === 'OWNER' ? '#/admin/logbook' : '#/account/status'); return }
      const activeStay = hasActiveStay(s.applications)
      const endedStay = hasEndedStay(s.applications)
      if (kind === 'account' && s.account.role !== 'OWNER' && window.location.hash.split('?')[0] === '#/account/status') {
        if (activeStay) { window.location.replace('#/resident/dashboard'); return }
        if (endedStay && !hasPendingApplication(s.applications)) { window.location.replace('#/resident/payments'); return }
      }
      if (kind === 'admin' && s.account.role !== 'OWNER') { window.location.hash = '/account/status'; return }
      if (kind === 'resident' || kind === 'resident-billing') {
        if (s.account.role === 'OWNER') { window.location.replace('#/admin/dashboard'); return }
        if (!activeStay && !(kind === 'resident-billing' && endedStay)) {
          window.location.replace(endedStay ? '#/resident/payments' : '#/account/status'); return
        }
      }
      setState('ready')
    }).catch(e => {
      if (!active) return
      if (e instanceof ApiError && e.status === 401) {
        if (kind === 'account') setState('ready')
        else window.location.hash = '/login'
      } else { setError(e instanceof Error ? e.message : 'Could not load your account.'); setState('error') }
    })
    return () => { active = false }
  }, [kind, sample])
  if (state === 'loading') return <main className="onboarding-loading" role="status">Loading your workspace…</main>
  if (state === 'error') return <main className="registration-shell"><p role="alert">{error}</p><a href="#/login">Back to sign in</a></main>
  return children
}
