import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hikes } from '../../data/hikes'
import { makeThumb, perceptualHash, processFiles, PHOTO_QUALITY, PHOTO_TYPE, slugify, thumbPath, unslugify, wordsMatch } from '../../lib/adminUtils'
import PhotoDropZone from './PhotoDropZone'
import HikeOptions from './HikeOptions'

export default function LogTripTab({ session, pendingHikeIds }) {
  const [hikeId, setHikeId] = useState('')
  const [customHike, setCustomHike] = useState('')
  const [isNewHike, setIsNewHike] = useState(false)
  const [reportText, setReportText] = useState('')
  const [hotTake, setHotTake] = useState('')
  const [photos, setPhotos] = useState([])
  const [existingPhotos, setExistingPhotos] = useState([])
  // What each existing photo looks like, for spotting a re-upload of the
  // same photograph in a different file (see perceptualHash).
  const [existingLooks, setExistingLooks] = useState([])
  // Thumbnails of the same photos: what the strip displays and what gets
  // hashed. Hashing the full-size ones meant downloading every photo on the
  // hike every time it was selected — 18 MB for Maple Pass — which is the
  // bandwidth problem that took the site down all over again.
  const [existingThumbs, setExistingThumbs] = useState([])
  // Supabase rows are one source; the other is the photos committed into
  // hikes.js, which the page shows and this tab used not to. Bandera had
  // six of those and zero rows, so the tab reported "no photos" while the
  // page displayed six, and two got uploaded again.
  const [uploadedCount, setUploadedCount] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [existingHashes, setExistingHashes] = useState(new Set())
  const [hasExistingReport, setHasExistingReport] = useState(false)
  const [pendingMatch, setPendingMatch] = useState(null)
  const [knownMatch, setKnownMatch] = useState(null)

  const selectedHikeId = hikeId || slugify(customHike)

  useEffect(() => {
    function resetHikeFields() {
      setReportText(''); setHotTake(''); setExistingPhotos([]); setExistingHashes(new Set())
      setExistingLooks([]); setExistingThumbs([]); setUploadedCount(0); setHasExistingReport(false)
    }
    if (!selectedHikeId || isNewHike || !session) {
      resetHikeFields()
      return
    }
    async function loadHikeData() {
      const [reportRes, photosRes] = await Promise.all([
        supabase.from('hike_reports').select('report_text, hot_take').eq('hike_id', selectedHikeId).eq('user_id', session.user.id).maybeSingle(),
        supabase.from('hike_photos').select('storage_path, display_order, file_hash').eq('hike_id', selectedHikeId).order('display_order', { ascending: true }),
      ])
      if (reportRes.data && (reportRes.data.report_text || reportRes.data.hot_take)) {
        setReportText(reportRes.data.report_text || ''); setHotTake(reportRes.data.hot_take || ''); setHasExistingReport(true)
      } else {
        setReportText(''); setHotTake(''); setHasExistingReport(false)
      }
      const publicUrl = (path) => supabase.storage.from('hike-photos').getPublicUrl(path).data.publicUrl
      const uploaded = (photosRes.data ?? []).map(p => publicUrl(p.storage_path))
      const uploadedThumbs = (photosRes.data ?? []).map(p => publicUrl(thumbPath(p.storage_path)))
      // Everything already on the hike page, uploads first, then the photos
      // committed into hikes.js (hiddenPhotos included — they are on the
      // hike, just suppressed from the gallery, and re-adding one is still
      // a duplicate).
      const hike = hikes.find(h => h.id === selectedHikeId || h.supabaseId === selectedHikeId)
      const fromRepo = hike ? [...new Set([...(hike.photos ?? []), ...(hike.hiddenPhotos ?? []), hike.cover].filter(Boolean))] : []
      const all = [...uploaded, ...fromRepo.filter(p => !uploaded.includes(p))]
      // Repo photos are served by Vercel and already web-sized, so they are
      // their own thumbnail.
      const allThumbs = [...uploadedThumbs, ...fromRepo.filter(p => !uploaded.includes(p))]
      setUploadedCount(uploaded.length)
      setExistingPhotos(all)
      setExistingThumbs(allThumbs)
      setExistingHashes(new Set((photosRes.data ?? []).filter(p => p.file_hash).map(p => p.file_hash)))
      setExistingLooks([])
      // Hashing reads each photo through a canvas, so it runs after the
      // thumbnails are on screen rather than holding them up.
      Promise.all(allThumbs.map(perceptualHash)).then(looks => setExistingLooks(looks.filter(Boolean)))
    }
    loadHikeData()
  }, [selectedHikeId, isNewHike, session])

  async function handlePhotoSelect(files) {
    try {
      const processed = await processFiles(files, existingHashes, existingLooks)
      setPhotos(prev => [...prev, ...processed])
    } catch (err) { setError(err.message) }
  }

  function handleDragEnter(e) { e.preventDefault(); setIsDragOver(true) }
  function handleDragOver(e) { e.preventDefault(); setIsDragOver(true) }
  function handleDragLeave(e) { if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragOver(false) }
  async function handleDrop(e) {
    e.preventDefault(); setIsDragOver(false)
    try {
      const processed = await processFiles(e.dataTransfer.files, existingHashes, existingLooks)
      setPhotos(prev => [...prev, ...processed])
    } catch (err) { setError(err.message) }
  }

  async function rotatePhoto(idx, direction) {
    const photo = photos[idx]
    const img = new Image()
    img.src = photo.previewUrl
    await new Promise(resolve => { img.onload = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = img.height; canvas.height = img.width
    const ctx = canvas.getContext('2d')
    if (direction === 'cw') { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2) }
    else { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2) }
    ctx.drawImage(img, 0, 0)
    // Already down to PHOTO_MAX_EDGE, so rotating does not resize again —
    // but the thumbnail has to be rebuilt or it stays on its old side.
    const previewUrl = canvas.toDataURL(PHOTO_TYPE, PHOTO_QUALITY)
    const thumbUrl = await makeThumb(previewUrl)
    setPhotos(prev => prev.map((p, i) => i === idx ? { ...p, previewUrl, thumbUrl } : p))
  }

  function removePhoto(idx) { setPhotos(prev => prev.filter((_, i) => i !== idx)) }

  function handleHikeSelect(e) {
    const val = e.target.value
    setHikeId(val); setCustomHike(''); setIsNewHike(false); setPendingMatch(null); setKnownMatch(null); setPhotos([])
  }

  function handleCustomHike(e) {
    const val = e.target.value
    setCustomHike(val); setHikeId(''); setPhotos([]); setPendingMatch(null); setKnownMatch(null)
    if (!val.length) { setIsNewHike(false); return }
    const slug = slugify(val)
    const exactKnown = hikes.find(h => h.id === slug || h.name.toLowerCase() === val.toLowerCase())
    if (exactKnown) { setKnownMatch(exactKnown); setIsNewHike(false); return }
    const wordKnownMatches = hikes.filter(h => wordsMatch(slug, h.id))
    if (wordKnownMatches.length === 1) { setKnownMatch(wordKnownMatches[0]); setIsNewHike(false); return }
    if (wordKnownMatches.length > 1) { setIsNewHike(false); return }
    const matched = pendingHikeIds.find(id => id === slug || wordsMatch(slug, id))
    if (matched) { setPendingMatch(matched); setIsNewHike(false); return }
    setIsNewHike(true)
  }

  async function handleSave() {
    if (!selectedHikeId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      if (reportText.trim() || hotTake.trim()) {
        const { error: reportError } = await supabase.from('hike_reports').upsert({
          hike_id: selectedHikeId, user_id: session.user.id, report_text: reportText,
          hot_take: hotTake, updated_at: new Date().toISOString(),
        }, { onConflict: 'hike_id,user_id' })
        if (reportError) throw reportError
      }
      for (let i = 0; i < photos.length; i++) {
        const blob = await fetch(photos[i].previewUrl).then(r => r.blob())
        const filename = `${Date.now()}_${i}.webp`
        const storagePath = `${selectedHikeId}/${session.user.id}/${filename}`
        const { error: uploadError } = await supabase.storage.from('hike-photos').upload(storagePath, blob, { contentType: PHOTO_TYPE })
        if (uploadError) throw uploadError
        // The gallery loads this one; only opening the lightbox pulls the
        // full-size photo. Same path with a thumb_ prefix, so nothing has
        // to be recorded for it.
        const thumbBlob = await fetch(photos[i].thumbUrl).then(r => r.blob())
        const { error: thumbError } = await supabase.storage.from('hike-photos').upload(thumbPath(storagePath), thumbBlob, { contentType: PHOTO_TYPE })
        if (thumbError) throw thumbError
        await supabase.from('hike_photos').insert({
          hike_id: selectedHikeId, user_id: session.user.id, storage_path: storagePath,
          display_order: uploadedCount + i, file_hash: photos[i].hash,
        })
      }
      setHikeId(''); setCustomHike(''); setIsNewHike(false); setReportText(''); setHotTake('')
      setPhotos([]); setExistingPhotos([]); setExistingHashes(new Set()); setHasExistingReport(false)
      setSaved(true); setTimeout(() => setSaved(false), 4000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  return (
    <main className="admin-main">
      <section className="admin-section">
        <label className="admin-label">NEW HIKE</label>
        <input className="admin-input" type="text" placeholder="New hike name…" value={customHike} onChange={handleCustomHike} />
        {knownMatch && <div className="admin-flag admin-flag-block">This hike exists as "{knownMatch.name}" — select it from the dropdown below.</div>}
        {pendingMatch && <div className="admin-flag admin-flag-block">Already logged as "{unslugify(pendingMatch)}" — select it from the dropdown below to add more photos.</div>}
        {isNewHike && <div className="admin-flag">⚠️ This hike doesn't have a page yet — flagged for development.</div>}
        <p className="admin-or">or add photos and reports to a previous hike</p>
        <select className="admin-input" value={hikeId} onChange={handleHikeSelect}>
          <HikeOptions pendingHikeIds={pendingHikeIds} />
        </select>
      </section>

      <section className="admin-section">
        <label className="admin-label">PHOTOS</label>
        {existingPhotos.length > 0 && (
          <div className="admin-existing-strip">
            <p className="admin-existing-label">
              {existingPhotos.length} photo{existingPhotos.length !== 1 ? 's' : ''} already on this hike
              {existingPhotos.length !== uploadedCount && ` (${uploadedCount} uploaded, ${existingPhotos.length - uploadedCount} on the page itself)`}
            </p>
            <div className="admin-existing-thumbs">
              {existingPhotos.map((url, i) => (
                <img
                  key={i}
                  src={existingThumbs[i] ?? url}
                  alt=""
                  className="admin-existing-thumb"
                  // A photo uploaded before thumbnails existed has none.
                  onError={e => { if (e.currentTarget.src !== url) e.currentTarget.src = url }}
                  onClick={() => setLightboxIndex(i)}
                />
              ))}
            </div>
          </div>
        )}
        {lightboxIndex !== null && (
          <div className="admin-lightbox" onClick={() => setLightboxIndex(null)}>
            <img src={existingPhotos[lightboxIndex]} alt="" className="admin-lightbox-img" onClick={e => e.stopPropagation()} />
            {existingPhotos.length > 1 && (
              <>
                <button className="admin-lightbox-arrow admin-lightbox-prev" onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + existingPhotos.length) % existingPhotos.length) }}>‹</button>
                <button className="admin-lightbox-arrow admin-lightbox-next" onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % existingPhotos.length) }}>›</button>
              </>
            )}
            <span className="admin-lightbox-count">{lightboxIndex + 1} / {existingPhotos.length}</span>
          </div>
        )}
        <PhotoDropZone
          photos={photos}
          onFilesSelected={handlePhotoSelect}
          onRemove={removePhoto}
          onRotate={rotatePhoto}
          isDragOver={isDragOver}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          emptyText="Drag photos here"
        />
      </section>

      <section className="admin-section">
        <label className="admin-label">TRIP REPORT <span className="admin-label-optional">optional</span></label>
        {hasExistingReport && <div className="admin-flag admin-flag-info">You've already submitted a report for this hike — saving will overwrite it.</div>}
        <textarea className="admin-textarea" rows={6} maxLength={350} placeholder="Write your trip report…" value={reportText} onChange={e => setReportText(e.target.value)} />
        <p className={`admin-char-count${reportText.length >= 330 ? ' admin-char-count-warn' : ''}`}>{reportText.length} / 350</p>
      </section>

      <section className="admin-section">
        <label className="admin-label">HOT TAKE <span className="admin-label-optional">optional</span></label>
        <input className="admin-input" type="text" placeholder="e.g. First Subaru to the trailhead, 15 there when we left!" value={hotTake} onChange={e => setHotTake(e.target.value)} />
      </section>

      {error && <p className="admin-error">{error}</p>}
      {saved && <p className="admin-success">Saved!</p>}
      <button className="admin-btn-primary" onClick={handleSave} disabled={saving || !selectedHikeId || !!pendingMatch || !!knownMatch}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </main>
  )
}
