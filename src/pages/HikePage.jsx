import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'
import TLTLogo from '../components/TLTLogo'

export default function HikePage() {
  const { slug } = useParams()
  const hike = hikes.find((h) => h.id === slug)
  const [reports, setReports] = useState([])
  const [uploadedPhotos, setUploadedPhotos] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const supabaseId = hike?.supabaseId || hike?.id

  useEffect(() => {
    if (!hike) return
    async function fetchContent() {
      const [reportRes, { data: photoData }] = await Promise.all([
        supabase
          .from('hike_reports')
          .select('user_id, report_text, hot_take')
          .eq('hike_id', supabaseId),
        supabase
          .from('hike_photos')
          .select('storage_path, display_order')
          .eq('hike_id', supabaseId)
          .order('display_order'),
      ])
      const AUTHORS = {
        '4d781942-cee2-4a99-ba03-aeb06eef81d1': 'Scott',
        'dd5d9dfd-2613-46d9-962a-e116bf5ba145': 'Alan',
      }
      const data = reportRes.data || []
      setReports(
        data
          .filter(r => r.report_text || r.hot_take)
          .map(r => ({ ...r, displayName: AUTHORS[r.user_id] || null }))
      )
      if (photoData) {
        const urls = photoData.map(p =>
          supabase.storage.from('hike-photos').getPublicUrl(p.storage_path).data.publicUrl
        )
        setUploadedPhotos(urls)
      }
    }
    fetchContent()
  }, [hike])

  if (!hike) {
    return (
      <div className="not-found">
        <p>Hike not found.</p>
        <Link to="/">← Back to all hikes</Link>
      </div>
    )
  }

  const hidden = new Set(hike.hiddenPhotos || [])
  const combined = [...hike.photos, ...uploadedPhotos.filter(url => !hidden.has(url))]
  const allPhotos = combined.length > 1 && combined[0] === hike.cover
    ? [...combined.slice(1), combined[0]]
    : combined

  const galleryItems = useMemo(() => {
    const n = allPhotos.length
    const photoItems = allPhotos.map((src, photoIdx) => ({ type: 'photo', src, photoIdx }))
    if (reports.length === 0) return photoItems

    // Insertion position = index in photoItems BEFORE which to insert a report card.
    // pos === n means append after all photos.
    let insertions
    if (reports.length === 1) {
      const pos = n > 1 ? Math.floor(Math.random() * (n - 1)) + 1 : n
      insertions = [{ pos, ri: 0 }]
    } else {
      const MIN_GAP = 3
      let pos1, pos2
      if (n > MIN_GAP + 1) {
        pos1 = Math.floor(Math.random() * (n - MIN_GAP)) + 1
        const lo = pos1 + MIN_GAP
        pos2 = lo + Math.floor(Math.random() * (n - lo + 1))
      } else {
        pos1 = Math.max(1, Math.floor(n / 3))
        pos2 = Math.min(n, pos1 + Math.max(1, n - pos1))
      }
      const [r0, r1] = Math.random() < 0.5 ? [0, 1] : [1, 0]
      insertions = [{ pos: pos1, ri: r0 }, { pos: pos2, ri: r1 }].sort((a, b) => a.pos - b.pos)
    }

    const result = []
    let ii = 0
    photoItems.forEach((item, i) => {
      while (ii < insertions.length && insertions[ii].pos === i) {
        result.push({ type: 'report', data: reports[insertions[ii++].ri] })
      }
      result.push(item)
    })
    while (ii < insertions.length) {
      result.push({ type: 'report', data: reports[insertions[ii++].ri] })
    }
    return result
  }, [allPhotos, reports])

  const handleKeyDown = useCallback((e) => {
    if (lightboxIndex === null) return
    if (e.key === 'ArrowRight') setLightboxIndex(i => (i + 1) % allPhotos.length)
    if (e.key === 'ArrowLeft')  setLightboxIndex(i => (i - 1 + allPhotos.length) % allPhotos.length)
    if (e.key === 'Escape')     setLightboxIndex(null)
  }, [lightboxIndex, allPhotos.length])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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
        <div className="hike-body-inner">
          <div className="hike-body-text">
            <h2 className="hike-section-heading">Description</h2>
            <p className="hike-description">{hike.description}</p>
          </div>
          <div className="hike-body-logo">
            <TLTLogo size={110} color="var(--forest)" />
          </div>
        </div>
      </div>

      <div className="hike-gallery">
        {galleryItems.map((item, i) => {
          if (item.type === 'report') {
            return (
              <div key={`report-${i}`} className="gallery-report-card">
                <p className="gallery-report-label">
                  From the Trail{item.data.displayName ? ` — ${item.data.displayName}` : ''}
                </p>
                {item.data.report_text && (
                  <p className="gallery-report-text">{item.data.report_text}</p>
                )}
                {item.data.hot_take && (
                  <blockquote className="gallery-report-hot-take">"{item.data.hot_take}"</blockquote>
                )}
                <div className="gallery-report-logo">
                  <TLTLogo size={44} color="white" />
                </div>
              </div>
            )
          }
          return (
            <div
              key={item.src}
              className={`gallery-item${item.photoIdx === 0 ? ' gallery-item-large' : ''}`}
              onClick={() => setLightboxIndex(item.photoIdx)}
            >
              <img
                src={item.src}
                alt={`${hike.name} — photo ${item.photoIdx + 1}`}
                loading={item.photoIdx < 2 ? 'eager' : 'lazy'}
              />
            </div>
          )
        })}
      </div>

      {lightboxIndex !== null && (
        <div className="gallery-lightbox" onClick={() => setLightboxIndex(null)}>
          <div className="gallery-lightbox-frame" onClick={e => e.stopPropagation()}>
            <img
              src={allPhotos[lightboxIndex]}
              alt={`${hike.name} — photo ${lightboxIndex + 1}`}
              className="gallery-lightbox-img"
            />
            <div className="gallery-lightbox-controls">
              {allPhotos.length > 1 && (
                <button
                  className="gallery-lightbox-arrow"
                  onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + allPhotos.length) % allPhotos.length) }}
                  aria-label="Previous photo"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 6 9 12 15 18" />
                  </svg>
                </button>
              )}
              <span className="gallery-lightbox-count">{lightboxIndex + 1} / {allPhotos.length}</span>
              {allPhotos.length > 1 && (
                <button
                  className="gallery-lightbox-arrow"
                  onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % allPhotos.length) }}
                  aria-label="Next photo"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
