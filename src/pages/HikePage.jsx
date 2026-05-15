import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'
import TLTLogo from '../components/TLTLogo'

export default function HikePage() {
  const { slug } = useParams()
  const hike = hikes.find((h) => h.id === slug)
  const [reports, setReports] = useState([])
  const [uploadedPhotos, setUploadedPhotos] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)

  useEffect(() => {
    if (!hike) return
    async function fetchContent() {
      const [{ data: reportData }, { data: photoData }] = await Promise.all([
        supabase
          .from('hike_reports')
          .select('report_text, hot_take, profiles(display_name)')
          .eq('hike_id', hike.id),
        supabase
          .from('hike_photos')
          .select('storage_path, display_order')
          .eq('hike_id', hike.id)
          .order('display_order'),
      ])
      if (reportData) setReports(reportData)
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

  const allPhotos = [...hike.photos, ...uploadedPhotos]

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

      {reports.length > 0 && (
        <div className="hike-reports">
          <h2 className="hike-reports-heading">From the Trail</h2>
          {reports.map((r, i) => (
            <div key={i} className="hike-report-card">
              <p className="hike-report-author">{r.profiles?.display_name}</p>
              {r.report_text && <p className="hike-report-text">{r.report_text}</p>}
              {r.hot_take && (
                <blockquote className="hike-hot-take">"{r.hot_take}"</blockquote>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="hike-gallery">
        {allPhotos.map((photo, i) => (
          <div
            key={photo}
            className={`gallery-item${i === 0 ? ' gallery-item-large' : ''}`}
            onClick={() => setLightboxIndex(i)}
          >
            <img
              src={photo}
              alt={`${hike.name} — photo ${i + 1}`}
              loading={i < 2 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <div className="gallery-lightbox" onClick={() => setLightboxIndex(null)}>
          <img
            src={allPhotos[lightboxIndex]}
            alt={`${hike.name} — photo ${lightboxIndex + 1}`}
            className="gallery-lightbox-img"
            onClick={e => e.stopPropagation()}
          />
          {allPhotos.length > 1 && (
            <>
              <button
                className="gallery-lightbox-arrow gallery-lightbox-prev"
                onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + allPhotos.length) % allPhotos.length) }}
                aria-label="Previous photo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                className="gallery-lightbox-arrow gallery-lightbox-next"
                onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % allPhotos.length) }}
                aria-label="Next photo"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            </>
          )}
          <span className="gallery-lightbox-count">{lightboxIndex + 1} / {allPhotos.length}</span>
        </div>
      )}
    </div>
  )
}
