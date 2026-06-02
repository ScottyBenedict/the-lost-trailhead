import { Link } from 'react-router-dom'
import { useRef, useCallback, useState } from 'react'

// ─── GPX helpers ────────────────────────────────────────────────────────────

function parseGPX(text) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  const trkpts = doc.querySelectorAll('trkpt')
  const points = []
  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'))
    const lon = parseFloat(pt.getAttribute('lon'))
    const eleEl = pt.querySelector('ele')
    const ele = eleEl ? parseFloat(eleEl.textContent) : null
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat, lon, ele })
  })
  return points
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function HikeCard({ hike, gpxUrl }) {
  const mapDivRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const initializedRef = useRef(false)
  const [touchFlipped, setTouchFlipped] = useState(false)

  const isFlippable = !!(hike.map || gpxUrl)

  const initGpxBack = useCallback(async () => {
    if (!gpxUrl || initializedRef.current) return
    initializedRef.current = true

    try {
      const [{ default: L }] = await Promise.all([
        import('leaflet'),
        import('leaflet/dist/leaflet.css'),
      ])

      const res = await fetch(gpxUrl)
      if (!res.ok) return
      const points = parseGPX(await res.text())
      if (points.length === 0) return

      if (!mapDivRef.current) return
      const map = L.map(mapDivRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        keyboard: false,
        touchZoom: false,
        tap: false,
      })
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }).addTo(map)

      const latlngs = points.map(p => [p.lat, p.lon])
      const line = L.polyline(latlngs, { color: '#e84343', weight: 2.5, opacity: 0.95 }).addTo(map)
      L.circleMarker(latlngs[0], {
        radius: 3, color: '#e84343', fillColor: '#e84343', fillOpacity: 1, weight: 0,
      }).addTo(map)

      map.fitBounds(line.getBounds(), { padding: [14, 14] })

      // Re-fit after flip animation settles
      setTimeout(() => {
        map.invalidateSize()
        map.fitBounds(line.getBounds(), { padding: [14, 14] })
      }, 700)

    } catch (_) { /* silent */ }
  }, [gpxUrl])

  function handleTouchStart(e) {
    if (!isFlippable || touchFlipped) return
    e.preventDefault()
    setTouchFlipped(true)
    initGpxBack()
  }

  return (
    <Link
      to={`/hikes/${hike.id}`}
      className={`hike-card${isFlippable ? ' hike-card-flippable' : ''}${touchFlipped ? ' touch-flipped' : ''}`}
      onMouseEnter={initGpxBack}
      onTouchStart={handleTouchStart}
    >
      <div className="hike-card-inner">

        {/* ── Front ── */}
        <div className="hike-card-front">
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
        </div>

        {/* ── Back ── */}
        {isFlippable && (
          <div className="hike-card-back">
            {gpxUrl ? (
              <div className="hike-card-map-container">
                <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
              </div>
            ) : (
              <>
                {hike.topo && <img src={hike.topo} className="hike-card-topo" alt="" aria-hidden="true" />}
                <img src={hike.map} alt={`${hike.name} route`} className="hike-card-map" />
              </>
            )}
            <div className="hike-card-back-body">
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
          </div>
        )}

      </div>
    </Link>
  )
}
