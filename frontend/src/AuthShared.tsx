import { useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import artwork from './auth-artwork.json'
import './App.css'

type Screen = 'login' | 'register' | 'reset'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; icon: string; error?: ReactNode }
export function AuthField({ label, icon, error, id, type = 'text', ...props }: FieldProps) {
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <div className="input-wrap">
      <img src={icon} alt="" aria-hidden="true" className="field-icon" />
      <input {...props} id={id} type={password && visible ? 'text' : type} required />
      {password && <button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>}
    </div>
    {error}
  </div>
}

export function WelcomePanel({ screen }: { screen: Screen }) {
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

