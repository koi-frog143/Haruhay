import { useEffect, useRef, useState } from 'react'
import type { FormEvent, InputHTMLAttributes } from 'react'
import artwork from './auth-artwork.json'
import './App.css'
import LandingPage from './LandingPage'
import CreateMaintenanceTicket from './CreateMaintenanceTicket'
import MaintenanceTicketDetails from './MaintenanceTicketDetails'
import MaintenanceTickets from './MaintenanceTickets'
import ResidentDashboard from './ResidentDashboard'
import VisitorLogbook from './VisitorLogbook'

type Screen = 'login' | 'register' | 'reset'
type Route = Screen | 'home' | 'resident-dashboard' | 'resident-logbook' | 'resident-maintenance' | 'resident-maintenance-new' | 'resident-maintenance-detail'
function currentScreen(): Route {
  const route = window.location.hash.replace('#', '')
  return route === '/register' ? 'register'
    : route === '/forgot-password' ? 'reset'
      : route === '/login' ? 'login'
        : route === '/resident/dashboard' ? 'resident-dashboard'
          : route === '/resident/logbook' ? 'resident-logbook'
            : route === '/resident/maintenance' ? 'resident-maintenance'
              : route === '/resident/maintenance/new' ? 'resident-maintenance-new'
                : route.startsWith('/resident/maintenance/') ? 'resident-maintenance-detail'
          : 'home'
}
const copy = {
  login: { badge: 'WELCOME HOME', title: 'Welcome back', subtitle: 'Sign in to manage your stay and stay in touch.', action: 'Sign in to Haruhay' },
  register: { badge: 'JOIN OUR COMMUNITY', title: 'Create your account', subtitle: 'Just a few details and you will be right at home.', action: 'Create an account' },
  reset: { badge: 'RESET ACCESS', title: 'Forgot your password?', subtitle: "We'll email a secure reset link so you can regain access.", action: 'Send reset link' },
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; icon: string }
function Field({ label, icon, id, type = 'text', ...props }: FieldProps) {
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <div className="input-wrap">
      <img src={icon} alt="" aria-hidden="true" className="field-icon" />
      <input {...props} id={id} type={password && visible ? 'text' : type} required />
      {password && <button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>}
    </div>
  </div>
}

function WelcomePanel({ screen }: { screen: Screen }) {
  const art = artwork[screen]
  return <aside className="welcome-panel" aria-label="Welcome to Haruhay">
    <img className="circle circle-bottom" src={art.DecorativeCircle} alt="" />
    <img className="circle circle-top" src={art.DecorativeCircle1} alt="" />
    <a className="brand" href="#/" aria-label="Haruhay home">
      <img className="brand-mark" src={art.HaruhayFinalWebFallbackMark} alt="" width="56" height="56" />
      <img className="brand-wordmark" src={art.HaruhayFinalWebFallbackWordmark} alt="Haruhay" width="172" height="46" />
    </a>
    <div className="welcome-content">
      <span className="badge welcome-badge">A SAFE SPACE FOR EVERYONE</span>
      <h2>Room to breathe.<br />Space to grow.<br />People who care.</h2>
      <p className="welcome-description">Stay connected to your home and the people who make it feel like one.</p>
      <div className="peace-card">
        <div className="peace-icon"><img src={art.IconShield} alt="" /></div>
        <div><h3>Your peace of mind matters.</h3><p>Simple, secure everyday living for residents and staff.</p></div>
      </div>
      <img className="stars" src={art.BackgroundMotifStars} alt="" />
    </div>
  </aside>
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
        {screen === 'login' ? <a href="#/register">New here? <strong>Create an account</strong></a>
          : screen === 'register' ? <a href="#/login">Already registered? <strong>Log in</strong></a>
            : <a href="#/login">Back to log in <span aria-hidden="true"> →</span></a>}
      </nav>
      {screen === 'login' && <footer className="auth-footer">
        <button type="button" className="admin-preview" onClick={() => setNotice('Administrator workspace is not included in this login and registration preview.')}>Preview administrator workspace</button>
        <p><img src={artwork.login.IconShield1} alt="" />Safe, private and made for your community.</p>
      </footer>}
    </div>
  </section>
}

export default function App() {
  const [screen, setScreen] = useState<Route>(currentScreen)
  useEffect(() => {
    const onHashChange = () => setScreen(currentScreen())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    if (screen !== 'home' || !['#haruhay-way', '#features', '#community'].includes(window.location.hash)) window.scrollTo(0, 0)
  }, [screen])
  if (screen === 'home') return <LandingPage />
  if (screen === 'resident-dashboard') return <ResidentDashboard />
  if (screen === 'resident-logbook') return <VisitorLogbook />
  if (screen === 'resident-maintenance') return <MaintenanceTickets />
  if (screen === 'resident-maintenance-new') return <CreateMaintenanceTicket />
  if (screen === 'resident-maintenance-detail') return <MaintenanceTicketDetails />
  return <main className="auth-shell">
    <WelcomePanel screen={screen} />
    <AuthForm key={screen} screen={screen} />
  </main>
}
