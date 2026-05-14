import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { hikes } from '../data/hikes'
import exifr from 'exifr'

export default function AdminPage() {
  const { session, signOut } = useAuth()
  const [hikeId, setHikeId] = useState('')
  const [customHike, setCustomHike] = useState('')
  const [isNewHike, setIsNewHike] = useState(false)
  const [reportText, setReportText] = useState('')
  const [hotTake, setHotTake] = useState('')
  const [photos, setPhotos] = useState([]) // { file, previewUrl, rotated }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef()

  const selectedHikeId = hikeId || customHike

  // Load existing report when hike changes
  useEffect(() => {
    if (!selectedHikeId || isNewHike || !session) return
    async function loadReport() {
      const { data } = await supabase
        .from('hike_reports')
        .select('report_text, hot_take')
        .eq('hike_id', selectedHikeId)
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (data) {
        setReportText(data.report_text || '')
        setHotTake(data.hot_take || '')
      } else {
        setReportText('')
        setHotTake('')
      }
    }
    loadReport()
  }, [selectedHikeId, isNewHike, session])

  function handleHikeSelect(e) {
    const val = e.target.value
    setHikeId(val)
    setCustomHike('')
    setIsNewHike(false)
  }

  function handleCustomHike(e) {
    const val = e.target.value
    setCustomHike(val)
    setHikeId('')
    const exists = hikes.some(
      h => h.name.toLowerCase() === val.toLowerCase() || h.id === val.toLowerCase().replace(/\s+/g, '-')
    )
    setIsNewHike(val.length > 0 && !exists)
  }

  async function handlePhotoSelect(e) {
    const files = Array.from(e.target.files)
    const processed = await Promise.all(files.map(async file => {
      const url = await rotateImage(file)
      return { file, previewUrl: url }
    }))
    setPhotos(prev => [...prev, ...processed])
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

  function removePhoto(idx) {
    setPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!selectedHikeId) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // Upsert report
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

      // Upload photos
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
          display_order: i,
        })
      }

      setPhotos([])
      setSaved(true)
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

      <main className="admin-main">
        <section className="admin-section">
          <label className="admin-label">Select hike</label>
          <select className="admin-input" value={hikeId} onChange={handleHikeSelect}>
            <option value="">— choose a hike —</option>
            {hikes.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <p className="admin-or">or type a new hike name</p>
          <input
            className="admin-input"
            type="text"
            placeholder="New hike name…"
            value={customHike}
            onChange={handleCustomHike}
          />
          {isNewHike && (
            <div className="admin-flag">
              ⚠️ This hike doesn't have a page yet — flagged for development.
            </div>
          )}
        </section>

        <section className="admin-section">
          <label className="admin-label">Trip report</label>
          <textarea
            className="admin-textarea"
            rows={6}
            placeholder="Write your trip report…"
            value={reportText}
            onChange={e => setReportText(e.target.value)}
          />
        </section>

        <section className="admin-section">
          <label className="admin-label">Hot take</label>
          <input
            className="admin-input"
            type="text"
            placeholder="e.g. First Subaru to the trailhead, 15 there when we left!"
            value={hotTake}
            onChange={e => setHotTake(e.target.value)}
          />
        </section>

        <section className="admin-section">
          <label className="admin-label">Photos</label>
          <button className="admin-btn-secondary" onClick={() => fileInputRef.current.click()}>
            Add photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
          {photos.length > 0 && (
            <div className="admin-photo-grid">
              {photos.map((p, i) => (
                <div key={i} className="admin-photo-thumb">
                  <img src={p.previewUrl} alt="" />
                  <button className="admin-photo-remove" onClick={() => removePhoto(i)}>×</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="admin-error">{error}</p>}
        {saved && <p className="admin-success">Saved!</p>}

        <button
          className="admin-btn-primary"
          onClick={handleSave}
          disabled={saving || !selectedHikeId}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </main>
    </div>
  )
}
