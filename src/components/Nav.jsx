import { Link, NavLink } from 'react-router-dom'

export default function Nav() {
  return (
    <>
      <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id="stamp-filter" x="-5%" y="-10%" width="110%" height="130%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4" stitchTiles="stitch" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feComposite in="displaced" in2="SourceGraphic" operator="atop" />
          </filter>
        </defs>
      </svg>

      <header className="nav">
        <div className="nav-inner">
          <nav className="nav-side nav-side--left">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              Hikes
            </NavLink>
          </nav>
          <Link to="/" className="nav-logo">The Lost Trailhead</Link>
          <nav className="nav-side nav-side--right">
            <NavLink to="/about" className={({ isActive }) => isActive ? 'active' : ''}>
              About
            </NavLink>
          </nav>
        </div>
      </header>
    </>
  )
}
