import { useParams, Link } from 'react-router-dom'
import { hikes } from '../data/hikes'

export default function HikePage() {
  const { slug } = useParams()
  const hike = hikes.find((h) => h.id === slug)

  if (!hike) {
    return (
      <div className="not-found">
        <p>Hike not found.</p>
        <Link to="/">← Back to all hikes</Link>
      </div>
    )
  }

  return (
    <div className="hike-page">
      <div
        className="hike-hero"
        style={{ backgroundImage: `url(${hike.cover})`, backgroundPosition: hike.coverPosition || 'center' }}
        role="img"
        aria-label={`${hike.name} cover photo`}
      >
        <div className="hike-hero-overlay">
          <div className="hike-hero-content">
            <Link to="/" className="back-link">← All Hikes</Link>
            <h1>{hike.name}</h1>
            <p className="hike-region-label">{hike.region}</p>
          </div>
        </div>
      </div>

      <div className="hike-stats-bar">
        {[
          { label: 'Distance', value: hike.distance },
          { label: 'Elevation Gain', value: hike.gain },
          { label: 'Difficulty', value: hike.difficulty },
          { label: 'Best Season', value: hike.season },
        ].map(({ label, value }) => (
          <div key={label} className="hike-stat">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
          </div>
        ))}
      </div>

      <div className="hike-body">
        <p className="hike-description">{hike.description}</p>
      </div>

      <div className="hike-gallery">
        {hike.photos.map((photo, i) => (
          <div
            key={photo}
            className={`gallery-item${i === 0 ? ' gallery-item-large' : ''}`}
          >
            <img
              src={photo}
              alt={`${hike.name} — photo ${i + 1}`}
              loading={i < 2 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
