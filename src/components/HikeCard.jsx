import { Link } from 'react-router-dom'

export default function HikeCard({ hike }) {
  return (
    <Link to={`/hikes/${hike.id}`} className="hike-card">
      <div className="hike-card-img">
        {hike.cover
          ? <img src={hike.cover} alt={hike.name} loading="lazy" />
          : <div className="hike-card-img-placeholder" aria-hidden="true" />}
      </div>
      <div className="hike-card-body">
        <p className="hike-card-region">{hike.region}</p>
        <h3 className="hike-card-name">{hike.name}</h3>
        <div className="hike-card-stats">
          <span>{hike.distance}</span>
          <span className="dot" aria-hidden="true" />
          <span>{hike.gain}</span>
          <span className="dot" aria-hidden="true" />
          <span>{hike.difficulty}</span>
        </div>
      </div>
    </Link>
  )
}
