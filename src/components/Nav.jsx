import { useState, useRef, useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 120)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id="distress-filter" x="-5%" y="-10%" width="110%" height="130%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="2" stitchTiles="stitch" result="edge-noise" />
            <feDisplacementMap in="SourceGraphic" in2="edge-noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="12" stitchTiles="stitch" result="speckle-noise" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  25 0 0 0 -19" in="speckle-noise" result="speckle-mask" />
            <feComposite in="displaced" in2="speckle-mask" operator="out" />
          </filter>
        </defs>
      </svg>

      <header className={`nav${scrolled ? ' nav-scrolled' : ''}`}>
        <div className="nav-inner">

          {/* Hamburger — always top-left */}
          <div className={`nav-hamburger-fixed${scrolled ? ' nav-hamburger-scrolled' : ''}`} ref={menuRef}>
            <button
              className={`nav-menu-btn${open ? ' is-open' : ''}`}
              onClick={() => setOpen(o => !o)}
              aria-label="Open menu"
              aria-expanded={open}
            >
              <span />
              <span />
              <span />
            </button>
            {open && (
              <nav className="nav-dropdown">
                <NavLink to="/" end onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}>
                  Hikes
                </NavLink>
                <NavLink to="/about" onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}>
                  About
                </NavLink>
              </nav>
            )}
          </div>

          {/* Full logo — centered, fades on scroll */}
          <Link to="/" className={`nav-logo${scrolled ? ' nav-logo-hidden' : ''}`}>
            <svg viewBox="0 390 1200 420" aria-hidden="true" className="nav-logo-icon" style={{ height: '1.05em', width: 'auto', display: 'inline-block', verticalAlign: 'middle', marginRight: '-0.16em', marginTop: '-0.1em' }}>
              <path fill="white" stroke="white" strokeWidth="17" strokeLinejoin="round" d="m187.13 796.5 12-24.469 26.062-16.594-7.125-33.562h18.141l22.922-6.7031 45.797 16.594v-9.8906l-27.656-20.109 9.0938-8.6719-14.625-19.781 26.531-46.594 56.391 31.594 24.469-23.672 27.656-7.0781 14.156 28.406 61.594 21.281 46.594 48.188 65.531 19.734 86.062 50.531-72.656-66.328-41.812-47.344-70.266-20.531-21.328-33.938-20.531-22.5 6.8438-21.281 17.625-7.5938 19.734-21.281v-24.469l31.594 11.062 20.531 22.078 89.531 117.42-39.516-113.48-22.406-16.547-3.9375-30-12.094-17.109 21.188-65.859 3.6562-3.2812 45.094 26.297 21.516 52.266 73.828 70.031 5.5312 40.266 88.781 99.047-68.25-95.062 2.7188-21.328-5.9062-13.453 8.2031-18.562 21.75 35.625 11.156 4.125 91.547 120.14 63.938 7.9219 117.28 54.469h10.406l-78.75-59.25-36.281-11.016 3.9375-26.859-22.125-7.125-15.797-10.219 15.797-19.781-10.5-14.156 30.516 17.203 18.75 32.344 46.406 6.2812 112.92 92.578h39.844l-142.31-116.67-41.203-5.5781-15.984-27.609-62.906-35.391-17.016 21.281-17.812 5.9062-21.984 19.359-53.484-65.109-9.3281-3.4688-25.359-41.531-42.891 2.25-54.141-51.281-22.688-55.125-68.578-40.031-62.344 57.188-73.594 35.953-17.531 39.891-40.594 23.203-62.062 52.875-33.188-15.797-82.312 71.016-59.156-9.6094-131.9 138.28z"/>
            </svg>
            <span className="nav-logo-text">The L<svg viewBox="14 0 72 100" aria-hidden="true" overflow="visible" style={{ height: '1em', width: 'auto', display: 'inline-block', verticalAlign: '-0.04em', marginLeft: '-0.14em', marginRight: '0.08em', transform: 'rotate(5deg)' }}>
                <path fillRule="evenodd" fill="white" d="M50,60 m-36,0 a36,36,0,1,0,72,0 a36,36,0,1,0,-72,0 M50,60 m-23,0 a23,23,0,1,0,46,0 a23,23,0,1,0,-46,0"/>
                <polygon points="50,10 43,24 57,24" fill="white"/>
                <polygon points="50,108 43,96 57,96" fill="white"/>
                <polygon points="100,60 86,53 86,67" fill="white"/>
                <polygon points="0,60 14,53 14,67" fill="white"/>
              </svg>st Trailhead</span>
          </Link>

        </div>
      </header>
    </>
  )
}
