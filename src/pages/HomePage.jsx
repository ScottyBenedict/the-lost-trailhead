import { hikes } from '../data/hikes'
import HikeCard from '../components/HikeCard'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <p className="hero-eyebrow">Based in the Pacific Northwest</p>
          <h1 className="hero-title">
            Two friends,<br />
            thirty years,<br />
            always another trail.
          </h1>
          <p className="hero-sub">
            A record of the trails, the views, and the conversations in between.
          </p>
        </div>
        <div className="hero-scroll-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      <section className="hikes-section">
        <div className="hike-grid">
          {hikes.map((hike) => (
            <HikeCard key={hike.id} hike={hike} />
          ))}
        </div>
      </section>
    </>
  )
}
