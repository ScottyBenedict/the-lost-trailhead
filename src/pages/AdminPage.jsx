import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { hikes } from '../data/hikes'
import exifr from 'exifr'

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function unslugify(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const STOP_WORDS = new Set(['and', 'the', 'a', 'an', 'of', 'at', 'in'])

function wordsMatch(inputSlug, candidateId) {
  const inputWords = inputSlug.split('-').filter(w => w.length > 2 && !STOP_WORDS.has(w))
  const candidateWords = candidateId.split('-').filter(w => w.length > 2 && !STOP_WORDS.has(w))
  if (inputWords.length < 2) return false
  return inputWords.every(w => candidateWords.some(cw => cw.startsWith(w) || w.startsWith(cw)))
}

export default function AdminPage() {
  const { session, signOut } = useAuth()
  const [hikeId, setHikeId] = useState('')
  const [customHike, setCustomHike] = useState('')
  const [isNewHike, setIsNewHike] = useState(false)
  const [reportText, setReportText] = useState('')
  const [hotTake, setHotTake] = useState('')
  const [photos, setPhotos] = useState([])
  const [existingPhotos, setExistingPhotos] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [activeTab, setActiveTab] = useState('log')
  const [pendingHikes, setPendingHikes] = useState([])
  const [pendingHikeIds, setPendingHikeIds] = useState([])
  const [pendingMatch, setPendingMatch] = useState(null)
  const [knownMatch, setKnownMatch] = useState(null)
  const [loadingPending, setLoadingPending] = useState(false)
  const fileInputRef = useRef()

  const selectedHikeId = hikeId || slugify(customHike)

  useEffect(() => {
    if (!selectedHikeId || isNewHike || !session) {
      setReportText('')
      setHotTake('')
      setExistingPhotos([])
      return
    }
    async function loadHikeData() {
      const [reportRes, photosRes] = await Promise.all([
        supabase
          .from('hike_reports')
          .select('report_text, hot_take')
          .eq('hike_id', selectedHikeId)
          .eq('user_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('hike_photos')
          .select('storage_path, display_order')
          .eq('hike_id', selectedHikeId)
          .eq('user_id', session.user.id)
          .order('display_order', { ascending: true }),
      ])
      if (reportRes.data) {
        setReportText(reportRes.data.report_text || '')
        setHotTake(reportRes.data.hot_take || '')
      } else {
        setReportText('')
        setHotTake('')
      }
      if (photosRes.data && photosRes.data.length > 0) {
        const urls = photosRes.data.map(p =>
          supabase.storage.from('hike-photos').getPublicUrl(p.storage_path).data.publicUrl
        )
        setExistingPhotos(urls)
      } else {
        setExistingPhotos([])
      }
    }
    loadHikeData()
  }, [selectedHikeId, isNewHike, session])

  useEffect(() => {
    if (!session) return
    async function fetchPendingIds() {
      const knownIds = new Set(hikes.map(h => h.id))
      const [{ data: reportData }, { data: photoData }] = await Promise.all([
        supabase.from('hike_reports').select('hike_id'),
        supabase.from('hike_photos').select('hike_id'),
      ])
      const all = new Set([
        ...(reportData || []).map(r => r.hike_id),
        ...(photoData || []).map(p => p.hike_id),
      ])
      setPendingHikeIds([...all].filter(id => !knownIds.has(id)))
    }
    fetchPendingIds()
  }, [session])

  useEffect(() => {
    if (activeTab !== 'pending' || !session) return
    async function fetchPending() {
      setLoadingPending(true)
      const knownIds = new Set(hikes.map(h => h.id))
      const [{ data: reportData }, { data: photoData }] = await Promise.all([
        supabase.from('hike_reports').select('hike_id, profiles(display_name)'),
        supabase.from('hike_photos').select('hike_id'),
      ])
      const byHike = {}
      for (const r of (reportData || [])) {
        if (knownIds.has(r.hike_id)) continue
        if (!byHike[r.hike_id]) byHike[r.hike_id] = { hike_id: r.hike_id, reports: 0, photos: 0, submitters: new Set() }
        byHike[r.hike_id].reports++
        if (r.profiles?.display_name) byHike[r.hike_id].submitters.add(r.profiles.display_name)
      }
      for (const p of (photoData || [])) {
        if (knownIds.has(p.hike_id)) continue
        if (!byHike[p.hike_id]) byHike[p.hike_id] = { hike_id: p.hike_id, reports: 0, photos: 0, submitters: new Set() }
        byHike[p.hike_id].photos++
      }
      setPendingHikes(Object.values(byHike).map(h => ({ ...h, submitters: [...h.submitters] })))
      setLoadingPending(false)
    }
    fetchPending()
  }, [activeTab, session])

  function handleHikeSelect(e) {
    const val = e.target.value
    setHikeId(val)
    setCustomHike('')
    setIsNewHike(false)
    setPhotos([])
  }

  function handleCustomHike(e) {
    const val = e.target.value
    setCustomHike(val)
    setHikeId('')
    setPhotos([])
    setPendingMatch(null)
    setKnownMatch(null)
    if (!val.length) { setIsNewHike(false); return }
    const slug = slugify(val)
    const exactKnown = hikes.find(h => h.id === slug || h.name.toLowerCase() === val.toLowerCase())
    if (exactKnown) { setIsNewHike(false); return }
    const wordKnown = hikes.find(h => wordsMatch(slug, h.id))
    if (wordKnown) { setKnownMatch(wordKnown); setIsNewHike(false); return }
    const matched = pendingHikeIds.find(id => id === slug || wordsMatch(slug, id))
    if (matched) { setPendingMatch(matched); setIsNewHike(false); return }
    setIsNewHike(true)
  }

  async function processFiles(files) {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    const processed = await Promise.all(imageFiles.map(async file => {
      const url = await rotateImage(file)
      return { file, previewUrl: url }
    }))
    setPhotos(prev => [...prev, ...processed])
  }

  async function handlePhotoSelect(e) {
    await processFiles(e.target.files)
    e.target.value = ''
  }

  function handleDragEnter(e) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragOver(e) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setIsDragOver(false)
  }

  async function handleDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    await processFiles(e.dataTransfer.files)
  }

  async function rotateImage(file) {
    const orientation = await exifr.parse(file, ['Orientation']).then(d => d?.Orientation).catch(() => 1)
    const img = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    const needsSwap = orientation >= 5 && orientation <= 8
    canvas.width = needsSwap ? img.height : img.width
    canvas.height = needsSwap ? img.width : img.height
    const ctx = canvas.getContext('2d')
    const transforms = {
      1: [],
      2: [{ scale: [-1, 1] }, { translate: [-img.width, 0] }],
      3: [{ rotate: Math.PI }, { translate: [-img.width, -img.height] }],
      4: [{ scale: [1, -1] }, { translate: [0, -img.height] }],
      5: [{ rotate: Math.PI / 2 }, { scale: [1, -1] }],
      6: [{ rotate: Math.PI / 2 }, { translate: [0, -img.height] }],
      7: [{ rotate: -Math.PI / 2 }, { scale: [-1, 1] }, { translate: [-img.width, -img.height] }],
      8: [{ rotate: -Math.PI / 2 }, { translate: [-img.width, 0] }],
    }
    const ops = transforms[orientation] || []
    for (const op of ops) {
      if (op.rotate !== undefined) ctx.rotate(op.rotate)
      if (op.scale) ctx.scale(...op.scale)
      if (op.translate) ctx.translate(...op.translate)
    }
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  async function rotatePhoto(idx, direction) {
    const photo = photos[idx]
    const img = new Image()
    img.src = photo.previewUrl
    await new Promise(resolve => { img.onload = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = img.height
    canvas.height = img.width
    const ctx = canvas.getContext('2d')
    if (direction === 'cw') {
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
    } else {
      ctx.translate(0, canvas.height)
      ctx.rotate(-Math.PI / 2)
    }
    ctx.drawImage(img, 0, 0)
    const newUrl = canvas.toDataURL('image/jpeg', 0.92)
    setPhotos(prev => prev.map((p, i) => i === idx ? { ...p, previewUrl: newUrl } : p))
  }

  function removePhoto(idx) {
    setPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!selectedHikeId) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      if (reportText.trim() || hotTake.trim()) {
        const { error: reportError } = await supabase
          .from('hike_reports')
          .upsert({
            hike_id: selectedHikeId,
            user_id: session.user.id,
            report_text: reportText,
            hot_take: hotTake,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'hike_id,user_id' })
        if (reportError) throw reportError
      }

      const newlyUploaded = []
      for (let i = 0; i < photos.length; i++) {
        const { previewUrl } = photos[i]
        const blob = await fetch(previewUrl).then(r => r.blob())
        const filename = `${Date.now()}_${i}.jpg`
        const storagePath = `${selectedHikeId}/${session.user.id}/${filename}`
        const { error: uploadError } = await supabase.storage
          .from('hike-photos')
          .upload(storagePath, blob, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        await supabase.from('hike_photos').insert({
          hike_id: selectedHikeId,
          user_id: session.user.id,
          storage_path: storagePath,
          display_order: existingPhotos.length + i,
        })
        newlyUploaded.push(
          supabase.storage.from('hike-photos').getPublicUrl(storagePath).data.publicUrl
        )
      }

      if (isNewHike) {
        setHikeId('')
        setCustomHike('')
        setIsNewHike(false)
        setReportText('')
        setHotTake('')
        setPhotos([])
        setExistingPhotos([])
      } else {
        setExistingPhotos(prev => [...prev, ...newlyUploaded])
        setPhotos([])
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-wrap">
      <header className="admin-header">
        <span className="admin-header-title">Trail Log Admin</span>
        <button className="admin-btn-ghost" onClick={signOut}>Sign out</button>
      </header>

      <nav className="admin-tabs">
        <button className={`admin-tab${activeTab === 'log' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('log')}>Log Trip</button>
        <button className={`admin-tab${activeTab === 'pending' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('pending')}>
          Needs a Page
          {pendingHikes.length > 0 && <span className="admin-tab-badge">{pendingHikes.length}</span>}
        </button>
      </nav>

      {activeTab === 'pending' && (
        <main className="admin-main">
          {loadingPending ? (
            <p className="admin-or">Loading…</p>
          ) : pendingHikes.length === 0 ? (
            <p className="admin-or">No pending hikes — you're all caught up.</p>
          ) : (
            <div className="admin-pending-list">
              {pendingHikes.map(h => (
                <div key={h.hike_id} className="admin-pending-item">
                  <p className="admin-pending-name">{unslugify(h.hike_id)}</p>
                  <p className="admin-pending-meta">
                    {h.photos} photo{h.photos !== 1 ? 's' : ''}
                    {h.reports > 0 && ` · ${h.reports} report${h.reports !== 1 ? 's' : ''}`}
                    {h.submitters.length > 0 && ` · ${h.submitters.join(', ')}`}
                  </p>
                  <p className="admin-pending-slug">{h.hike_id}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {activeTab === 'log' && <main className="admin-main">
        <section className="admin-section">
          <label className="admin-label">NEW HIKE</label>
          <input
            className="admin-input"
            type="text"
            placeholder="New hike name…"
            value={customHike}
            onChange={handleCustomHike}
          />
          {knownMatch && (
            <div className="admin-flag admin-flag-block">
              This hike exists as "{knownMatch.name}" — select it from the dropdown below.
            </div>
          )}
          {pendingMatch && (
            <div className="admin-flag admin-flag-block">
              Already logged as "{unslugify(pendingMatch)}" — select it from the dropdown below to add more photos.
            </div>
          )}
          {isNewHike && (
            <div className="admin-flag">
              ⚠️ This hike doesn't have a page yet — flagged for development.
            </div>
          )}
          <p className="admin-or">or add photos and reports to a previous hike</p>
          <select className="admin-input" value={hikeId} onChange={handleHikeSelect}>
            <option value="">— choose a hike —</option>
            <optgroup label="Published hikes">
              {hikes.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </optgroup>
            {pendingHikeIds.length > 0 && (
              <optgroup label="Needs a page">
                {pendingHikeIds.map(id => (
                  <option key={id} value={id}>{unslugify(id)}</option>
                ))}
              </optgroup>
            )}
          </select>
        </section>

        <section className="admin-section">
          <label className="admin-label">PHOTOS</label>

          {existingPhotos.length > 0 && (
            <div className="admin-existing-strip">
              <p className="admin-existing-label">{existingPhotos.length} photo{existingPhotos.length !== 1 ? 's' : ''} already on this hike</p>
              <div className="admin-existing-thumbs">
                {existingPhotos.map((url, i) => (
                  <img key={i} src={url} alt="" className="admin-existing-thumb" onClick={() => setLightboxIndex(i)} />
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

          <div
            className={`admin-drop-zone${isDragOver ? ' admin-drop-zone-active' : ''}${photos.length > 0 ? ' admin-drop-zone-has-photos' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handlePhotoSelect}
            />
            {photos.length === 0 ? (
              <>
                <span className="admin-drop-icon">↑</span>
                <p className="admin-drop-text">Drag photos here or <span className="admin-drop-link">click to browse</span></p>
              </>
            ) : (
              <>
                <div className="admin-photo-grid" onClick={e => e.stopPropagation()}>
                  {photos.map((p, i) => (
                    <div key={i} className="admin-photo-thumb">
                      <img src={p.previewUrl} alt="" />
                      <div className="admin-photo-controls">
                        <button className="admin-photo-ctrl" onClick={(e) => { e.stopPropagation(); rotatePhoto(i, 'ccw') }} title="Rotate left">↺</button>
                        <button className="admin-photo-ctrl" onClick={(e) => { e.stopPropagation(); rotatePhoto(i, 'cw') }} title="Rotate right">↻</button>
                        <button className="admin-photo-ctrl admin-photo-ctrl-remove" onClick={(e) => { e.stopPropagation(); removePhoto(i) }} title="Remove">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="admin-drop-add-more">Drop more or <span className="admin-drop-link">click to browse</span></p>
              </>
            )}
          </div>
        </section>

        <section className="admin-section">
          <label className="admin-label">TRIP REPORT <span className="admin-label-optional">optional</span></label>
          <textarea
            className="admin-textarea"
            rows={6}
            placeholder="Write your trip report…"
            value={reportText}
            onChange={e => setReportText(e.target.value)}
          />
        </section>

        <section className="admin-section">
          <label className="admin-label">HOT TAKE <span className="admin-label-optional">optional</span></label>
          <input
            className="admin-input"
            type="text"
            placeholder="e.g. First Subaru to the trailhead, 15 there when we left!"
            value={hotTake}
            onChange={e => setHotTake(e.target.value)}
          />
        </section>

        {error && <p className="admin-error">{error}</p>}
        {saved && <p className="admin-success">Saved!</p>}

        <button
          className="admin-btn-primary"
          onClick={handleSave}
          disabled={saving || !selectedHikeId || !!pendingMatch || !!knownMatch}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </main>}
    </div>
  )
}
