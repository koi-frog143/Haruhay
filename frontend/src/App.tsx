import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AuthField as Field, WelcomePanel } from './AuthShared'
import artwork from './auth-artwork.json'
import './App.css'
import BillingPayments from './BillingPayments'
import LandingPage from './LandingPage'
import CreateMaintenanceTicket from './CreateMaintenanceTicket'
import MaintenanceTicketDetails from './MaintenanceTicketDetails'
import MaintenanceTickets from './MaintenanceTickets'
import PaymentHistory from './PaymentHistory'
import ResidentDashboard from './ResidentDashboard'
import VisitorLogbook from './VisitorLogbook'
import ResidentProfile from './ResidentProfile'
import HoldingStation from './HoldingStation'
import RegisterVisitor from './RegisterVisitor'
import AccessHistory from './AccessHistory'
import CommunityBoard from './CommunityBoard'
import AdminApp from './AdminApp'
import RegistrationFlow from './RegistrationFlow'
import WorkspaceGate from './WorkspaceGate'
import { setWorkspaceMode } from './workspaceSession'

type Screen = 'login' | 'register' | 'reset'
type Route = Screen | 'account' | 'admin' | 'home' | 'resident-dashboard' | 'resident-logbook' | 'resident-register-visitor' | 'resident-access-history' | 'resident-community' | 'resident-maintenance' | 'resident-maintenance-new' | 'resident-maintenance-detail' | 'resident-payments' | 'resident-payment-history' | 'resident-profile' | 'resident-holding' | 'desk-holding'
function currentScreen(): Route {
  const route = window.location.hash.replace('#', '')
  if (route === '/login' || route === '/register') return 'account'
  if (route === '/preview/login') return 'login'
  if (route === '/preview/register') return 'register'
  if (route === '/account' || route.startsWith('/account/')) return 'account'
  if (route === '/admin' || route.startsWith('/admin/')) return 'admin'
  if (route === '/resident/holding-station') return 'resident-holding'
  if (route === '/front-desk/holding-station') return 'desk-holding'
  if (route === '/resident/profile') return 'resident-profile'
  if (route === '/resident/logbook/register') return 'resident-register-visitor'
  if (route === '/resident/logbook/access-history') return 'resident-access-history'
  if (route === '/resident/community') return 'resident-community'
  return route === '/register' ? 'register'
    : route === '/forgot-password' ? 'reset'
      : route === '/login' ? 'login'
        : route === '/resident/dashboard' ? 'resident-dashboard'
          : route === '/resident/logbook' ? 'resident-logbook'
            : route === '/resident/maintenance' ? 'resident-maintenance'
              : route === '/resident/maintenance/new' ? 'resident-maintenance-new'
                : route.startsWith('/resident/maintenance/') ? 'resident-maintenance-detail'
                  : route === '/resident/payments/history' ? 'resident-payment-history'
                    : route === '/resident/payments' ? 'resident-payments'
          : 'home'
}
const copy = {
  login: { badge: 'WELCOME HOME', title: 'Welcome back', subtitle: 'Sign in to manage your stay and stay in touch.', action: 'Sign in to Haruhay' },
  register: { badge: 'JOIN OUR COMMUNITY', title: 'Create your account', subtitle: 'Just a few details and you will be right at home.', action: 'Create an account' },
  reset: { badge: 'RESET ACCESS', title: 'Forgot your password?', subtitle: "We'll email a secure reset link so you can regain access.", action: 'Send reset link' },
}

function AuthForm({ screen }: { screen: Screen }) {
  const art = artwork[screen]
  const content = copy[screen]
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    document.title = content.title + ' | Haruhay'
    if (window.location.hash) heading.current?.focus()
  }, [content.title])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setNotice('')
    setError('')
    if (screen === 'register' && !String(data.get('fullName')).trim()) {
      setError('Please enter your full name.')
      event.currentTarget.querySelector<HTMLInputElement>('#full-name')?.focus()
      return
    }
    setWorkspaceMode('sample')
    // UI preview only: never send, save, or log credentials.
    setNotice(screen === 'login'
      ? 'Login preview complete. Your form is valid; no sign-in request was sent.'
      : screen === 'register'
        ? 'Registration preview complete. Your form is valid; no account was created.'
        : 'Reset preview complete. Your email is valid; no reset email was sent.')
    const password = event.currentTarget.elements.namedItem('password')
    if (password instanceof HTMLInputElement) password.value = ''
    if (screen === 'login') window.location.hash = '/resident/dashboard'
  }

  return <section className={'form-panel ' + screen} aria-labelledby="auth-title">
    <div className="auth-content">
      <header className="auth-header">
        <span className="badge">{content.badge}</span>
        <h1 id="auth-title" ref={heading} tabIndex={-1}>{content.title}</h1>
        <p>{content.subtitle}</p>
      </header>
      <form onSubmit={submit} className="auth-form">
        {screen === 'register' && <Field id="full-name" name="fullName" label="Full name" icon={artwork.register.IconUser} placeholder="Andrea Santos" autoComplete="name" maxLength={100} />}
        <Field id="email" name="email" label="Email address" icon={art.IconMail} type="email" placeholder="you@example.com" autoComplete="email" maxLength={254} />
        {screen !== 'reset' && <Field id="password" name="password" label="Password" icon={artwork[screen].IconLock} type="password" placeholder={screen === 'register' ? 'Create a secure password' : 'Enter your password'} autoComplete={screen === 'register' ? 'new-password' : 'current-password'} minLength={screen === 'register' ? 8 : undefined} title={screen === 'register' ? 'Use at least 8 characters.' : undefined} />}
        {screen === 'register' && <div className="form-field">
          <label htmlFor="property">Dormitory / property</label>
          <div className="input-wrap">
            <img className="field-icon" src={artwork.register.IconBuilding} alt="" />
            <select id="property" name="property" defaultValue="" required>
              <option value="" disabled>Choose your boarding house</option>
              <option value="demo">Haruhay boarding house (preview)</option>
            </select>
          </div>
        </div>}
        {screen === 'login' && <a className="forgot-link" href="#/forgot-password">Forgot password?</a>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit">{content.action}</button>
        <div className="form-notice" role="status" aria-live="polite">{notice}</div>
      </form>
      <nav className="auth-nav" aria-label="Account">
        <a href="#/account/login">Registration & owner approval</a>
        {screen === 'login' ? <a href="#/preview/register">New here? <strong>Create an account</strong></a>
          : screen === 'register' ? <a href="#/preview/login">Already registered? <strong>Log in</strong></a>
            : <a href="#/preview/login">Back to log in <span aria-hidden="true"> →</span></a>}
      </nav>
      {screen === 'login' && <footer className="auth-footer">
        <button type="button" className="admin-preview" onClick={() => { setWorkspaceMode('sample'); window.location.hash = '/admin/dashboard' }}>Preview administrator workspace</button>
        <p><img src={artwork.login.IconShield1} alt="" />Safe, private and made for your community.</p>
      </footer>}
    </div>
  </section>
}

export default function App() {
  const [routeHash, setRouteHash] = useState(() => window.location.hash)
  const screen = currentScreen()
  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    if (screen !== 'home' || !['#haruhay-way', '#features', '#community'].includes(window.location.hash)) window.scrollTo(0, 0)
  }, [screen])
  const guard = (page: ReactNode, kind: 'account' | 'admin' | 'resident') => <WorkspaceGate key={routeHash} kind={kind}>{page}</WorkspaceGate>
  if (screen === 'admin') return guard(<AdminApp key={routeHash} />, 'admin')
  if (screen === 'account') return ['/account/status', '/account/property', '/account/activate'].includes(window.location.hash.split('?')[0].slice(1)) ? guard(<RegistrationFlow key={routeHash} />, 'account') : <RegistrationFlow key={routeHash} />
  if (screen === 'resident-holding') return guard(<HoldingStation key='resident' />, 'resident')
  if (screen === 'desk-holding') return <HoldingStation key='desk' desk />
  if (screen === 'resident-profile') return guard(<ResidentProfile />, 'resident')
  if (screen === 'home') return <LandingPage />
  if (screen === 'resident-dashboard') return guard(<ResidentDashboard />, 'resident')
  if (screen === 'resident-logbook') return guard(<VisitorLogbook />, 'resident')
  if (screen === 'resident-register-visitor') return guard(<RegisterVisitor />, 'resident')
  if (screen === 'resident-access-history') return guard(<AccessHistory />, 'resident')
  if (screen === 'resident-community') return guard(<CommunityBoard />, 'resident')
  if (screen === 'resident-maintenance') return guard(<MaintenanceTickets />, 'resident')
  if (screen === 'resident-maintenance-new') return guard(<CreateMaintenanceTicket />, 'resident')
  if (screen === 'resident-maintenance-detail') return guard(<MaintenanceTicketDetails key={routeHash} />, 'resident')
  if (screen === 'resident-payments') return guard(<BillingPayments />, 'resident')
  if (screen === 'resident-payment-history') return guard(<PaymentHistory />, 'resident')
  return <main className="auth-shell">
    <WelcomePanel screen={screen} />
    <AuthForm key={screen} screen={screen} />
  </main>
}
