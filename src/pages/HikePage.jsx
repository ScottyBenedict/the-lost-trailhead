import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'
import TLTLogo from '../components/TLTLogo'
import HikeMap from '../components/HikeMap'
import HikeMapCard from '../components/HikeMapCard'

export default function HikePage() {
  const { slug } = useParams()
  const hike = hikes.find((h) => h.id === slug)
  const [reports, setReports] = useState([])
  const [uploadedPhotos, setUploadedPhotos] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [gpxUrl, setGpxUrl] = useState(null)

  const supabaseId = hike?.supabaseId || hike?.id

  // Locks background scroll while the lightbox is open. Compensating with paddingRight
  // matters: overflow:hidden removes the scrollbar, which widens the page by its width
  // and reflows the gallery grid — that reflow was the actual cause of the background
  // content visibly jumping/shifting when the lightbox opened.
  useEffect(() => {
    if (lightboxIndex === null) return
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevPaddingRight = document.body.style.paddingRight
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.paddingRight = prevPaddingRight
    }
  }, [lightboxIndex])

  useEffect(() => {
    if (!hike) return
    async function fetchContent() {
      const [reportRes, { data: photoData }, { data: gpxData }] = await Promise.all([
        supabase
          .from('hike_reports')
          .select('user_id, report_text, hot_take')
          .eq('hike_id', supabaseId),
        supabase
          .from('hike_photos')
          .select('storage_path, display_order')
          .eq('hike_id', supabaseId)
          .order('display_order'),
        supabase
          .from('hike_gpx')
          .select('gpx_url')
          .eq('hike_id', supabaseId)
          .maybeSingle(),
      ])
      setGpxUrl(gpxData?.gpx_url || null)
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

  // Memoized so this array keeps a stable reference across unrelated re-renders (e.g.
  // opening/closing the lightbox). Without that, galleryItems below — which depends on
  // this by reference and picks the report card's position with Math.random() — recomputed
  // on every render and reshuffled the report card to a new spot each time.
  const allPhotos = useMemo(() => {
    const hidden = new Set(hike.hiddenPhotos || [])
    const start = hike.galleryStart ?? 0
    const filtered = uploadedPhotos.filter(url => !hidden.has(url))
    const reordered = start > 0 ? [...filtered.slice(start), ...filtered.slice(0, start)] : filtered
    const combined = [...hike.photos, ...reordered]
    return combined.length > 1 && combined[0] === hike.cover
      ? [...combined.slice(1), combined[0]]
      : combined
  }, [hike, uploadedPhotos])

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
    if (gpxUrl) result.unshift({ type: 'map' })
    return result
  }, [allPhotos, reports, gpxUrl])

  // Lightbox carousel: map slide (if present) is index 0, followed by all photos —
  // lets the flyover be reached both by clicking its grid card and by arrowing
  // past it from the photos.
  const lightboxItems = useMemo(() => {
    const photoSlides = allPhotos.map(src => ({ type: 'photo', src }))
    return gpxUrl ? [{ type: 'map' }, ...photoSlides] : photoSlides
  }, [allPhotos, gpxUrl])
  const photoIndexOffset = gpxUrl ? 1 : 0

  const handleKeyDown = useCallback((e) => {
    if (lightboxIndex === null) return
    if (e.key === 'ArrowRight') setLightboxIndex(i => (i + 1) % lightboxItems.length)
    if (e.key === 'ArrowLeft')  setLightboxIndex(i => (i - 1 + lightboxItems.length) % lightboxItems.length)
    if (e.key === 'Escape')     setLightboxIndex(null)
  }, [lightboxIndex, lightboxItems.length])

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
          if (item.type === 'map') {
            return (
              <HikeMapCard key={`map-${i}`} gpxUrl={gpxUrl} onOpen={() => setLightboxIndex(0)} />
            )
          }
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
              className="gallery-item"
              onClick={() => setLightboxIndex(item.photoIdx + photoIndexOffset)}
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
          <div
            className={`gallery-lightbox-frame${lightboxItems[lightboxIndex].type === 'map' ? ' gallery-lightbox-frame-map' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="gallery-lightbox-close"
              onClick={e => { e.stopPropagation(); setLightboxIndex(null) }}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {lightboxItems[lightboxIndex].type === 'map' ? (
              <HikeMap gpxUrl={gpxUrl} hikeName={hike.name} />
            ) : (
              <img
                src={lightboxItems[lightboxIndex].src}
                alt={`${hike.name} — photo ${lightboxIndex + 1 - photoIndexOffset}`}
                className="gallery-lightbox-img"
              />
            )}
            <div className="gallery-lightbox-controls">
              {lightboxItems.length > 1 && (
                <button
                  className="gallery-lightbox-arrow"
                  onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + lightboxItems.length) % lightboxItems.length) }}
                  aria-label="Previous"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 6 9 12 15 18" />
                  </svg>
                </button>
              )}
              <span className="gallery-lightbox-count">{lightboxIndex + 1} / {lightboxItems.length}</span>
              {lightboxItems.length > 1 && (
                <button
                  className="gallery-lightbox-arrow"
                  onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % lightboxItems.length) }}
                  aria-label="Next"
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
