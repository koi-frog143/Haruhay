import { useEffect, useRef } from 'react'
import art from './landing-artwork.json'
import './LandingPage.css'

const features = [
  { title: 'Visitor logbook', description: 'Stay informed about your shared space.', icon: art.IconBook },
  { title: 'Maintenance care', description: 'Let us know what needs attention.', icon: art.IconTicket },
  { title: 'Easy payments', description: 'Know what is due and what is paid.', icon: art.IconWallet },
]

export default function LandingPage() {
  const contact = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    document.title = 'Haruhay | A place to belong'
    const scrollToSection = () => {
      const id = window.location.hash.slice(1)
      if (['haruhay-way', 'features', 'community'].includes(id)) {
        document.getElementById(id)?.scrollIntoView({ block: 'start' })
      }
    }
    scrollToSection()
    window.addEventListener('hashchange', scrollToSection)
    return () => window.removeEventListener('hashchange', scrollToSection)
  }, [])

  return <div className="landing-page">
    <a className="landing-skip" href="#features">Skip to features</a>
    <header className="landing-header">
      <a className="landing-brand" href="#/" aria-label="Haruhay home">
        <img src={art.HaruhayFinalWebFallbackMark} width="56" height="56" alt="" />
        <img src={art.HaruhayFinalWebFallbackWordmark} width="172" height="46" alt="Haruhay" />
      </a>
      <nav className="landing-links" aria-label="Main navigation">
        <a href="#haruhay-way">The Haruhay way</a>
        <a href="#features">Features</a>
        <a href="#community">Our community</a>
        <button type="button" onClick={() => contact.current?.showModal()}>Contact</button>
      </nav>
      <div className="landing-account">
        <a className="landing-button landing-button-secondary" href="#/login">Log in</a>
        <a className="landing-button landing-button-primary" href="#/register">Join Haruhay</a>
      </div>
    </header>
    <main className="landing-main">
      <section id="haruhay-way" className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <span className="badge landing-badge">A BETTER WAY TO FEEL AT HOME</span>
          <h1 id="landing-title">Your space. Your people.<br />A place to belong.</h1>
          <p className="landing-description">A thoughtful home for boarding-house life — manage visitors, service concerns, rent, and community updates, all in one safe and welcoming place.</p>
          <div className="landing-cta">
            <a className="landing-button landing-button-primary" href="#/login">Explore your space</a>
            <a className="landing-button landing-button-secondary" href="#features">Learn how it works</a>
          </div>
          <p id="community" className="landing-trust"><img src={art.IconShield} width="21" height="21" alt="" />A caring community, supported by secure records</p>
        </div>
        <div className="landing-visual" aria-label="A welcoming residence with safely logged arrivals and front desk package updates">
          <img className="landing-circle-large" src={art.DecorativeCircle} width="536" height="536" alt="" />
          <img className="landing-circle-small" src={art.DecorativeCircle1} width="300" height="300" alt="" />
          <img className="landing-stars" src={art.BackgroundMotifStars} width="110" height="136.4" alt="" />
          <img className="landing-residence" src={art.IllustrationCaringResidence} width="541" height="431" alt="" />
          <div className="landing-update landing-arrivals">
            <img src={art.IconShield1} width="34" height="34" alt="" />
            <div><h2>A little more peace.</h2><p>Your arrivals, safely logged.</p></div>
          </div>
          <div className="landing-update landing-package">
            <img src={art.IconBox} width="34" height="34" alt="" />
            <div><h2>Package received!</h2><p>Ready at your front desk.</p></div>
          </div>
        </div>
      </section>
      <section id="features" className="landing-features" aria-labelledby="features-title">
        <img className="landing-wave" src={art.BackgroundMotifWave} width="432" height="192" alt="" />
        <h2 id="features-title">Everything you need to feel settled</h2>
        <div className="landing-feature-grid">
          {features.map(feature => <a key={feature.title} className="landing-feature-card" href="#/login">
            <span className="landing-feature-icon"><img src={feature.icon} width="26" height="26" alt="" /></span>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </a>)}
        </div>
      </section>
    </main>
    <dialog className="landing-contact" ref={contact} aria-labelledby="contact-title" onClick={event => { if (event.target === event.currentTarget) contact.current?.close() }}>
      <h2 id="contact-title">Contact Haruhay</h2>
      <p>For help with your stay, please contact your boarding house’s front desk.</p>
      <form method="dialog"><button className="landing-button landing-button-primary">Close</button></form>
    </dialog>
  </div>
}
