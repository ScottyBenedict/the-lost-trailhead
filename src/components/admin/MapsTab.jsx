import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hikes } from '../../data/hikes'
import { slugify, uploadGpxFile } from '../../lib/adminUtils'
import GpxUploadControl from './GpxUploadControl'
import HikeOptions from './HikeOptions'

export default function MapsTab({ session, pendingHikeIds = [] }) {
  const [gpxHikeId, setGpxHikeId] = useState('')
  // A brand-new hike with no page, no photos, and no reports yet still has
  // no id anywhere to pick from a dropdown — GPX can legitimately be the
  // very first thing added for it. Mirrors LogTripTab's own "type a new
  // hike name" input for exactly the same reason.
  const [customHike, setCustomHike] = useState('')
  const [gpxFile, setGpxFile] = useState(null)
  const [gpxExistingUrl, setGpxExistingUrl] = useState(null)
  const [gpxSaving, setGpxSaving] = useState(false)
  const [gpxSaved, setGpxSaved] = useState(false)
  const [gpxError, setGpxError] = useState(null)

  const selectedGpxHikeId = gpxHikeId || slugify(customHike)

  const [dateHikeId, setDateHikeId] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [dateNotes, setDateNotes] = useState('')
  const [existingDates, setExistingDates] = useState([])
  const [dateSaving, setDateSaving] = useState(false)
  const [dateSaved, setDateSaved] = useState(false)
  const [dateError, setDateError] = useState(null)

  useEffect(() => {
    function clearGpxUrl() { setGpxExistingUrl(null) }
    if (!selectedGpxHikeId || !session) { clearGpxUrl(); return }
    supabase.from('hike_gpx').select('gpx_url').eq('hike_id', selectedGpxHikeId).maybeSingle()
      .then(({ data }) => setGpxExistingUrl(data?.gpx_url || null))
  }, [selectedGpxHikeId, session])

  useEffect(() => {
    function clearDates() { setExistingDates([]) }
    if (!dateHikeId || !session) { clearDates(); return }
    supabase.from('hike_dates').select('id, hike_date, notes').eq('hike_id', dateHikeId).order('hike_date', { ascending: false })
      .then(({ data }) => setExistingDates(data || []))
  }, [dateHikeId, session])

  async function handleGpxSave() {
    if (!selectedGpxHikeId || !gpxFile) return
    setGpxSaving(true); setGpxError(null); setGpxSaved(false)
    try {
      const gpx_url = await uploadGpxFile(selectedGpxHikeId, gpxFile, session.user.id)
      setGpxExistingUrl(gpx_url); setGpxFile(null)
      setGpxSaved(true); setTimeout(() => setGpxSaved(false), 4000)
    } catch (err) { setGpxError(err.message) }
    finally { setGpxSaving(false) }
  }

  async function handleDateSave() {
    if (!dateHikeId || !dateValue) return
    setDateSaving(true); setDateError(null); setDateSaved(false)
    try {
      const { data, error } = await supabase.from('hike_dates').insert({
        hike_id: dateHikeId, hike_date: dateValue, notes: dateNotes.trim() || null,
      }).select().single()
      if (error) throw error
      setExistingDates(prev => [data, ...prev].sort((a, b) => b.hike_date.localeCompare(a.hike_date)))
      setDateValue(''); setDateNotes('')
      setDateSaved(true); setTimeout(() => setDateSaved(false), 3000)
    } catch (err) { setDateError(err.message) }
    finally { setDateSaving(false) }
  }

  async function handleDateDelete(id) {
    const { error } = await supabase.from('hike_dates').delete().eq('id', id)
    if (!error) setExistingDates(prev => prev.filter(d => d.id !== id))
  }

  return (
    <main className="admin-main">
      <section className="admin-section">
        <label className="admin-label">UPLOAD GPX ROUTE</label>
        <p className="admin-or">
          Type a new hike name, or select an existing one, then upload its GPX file. This powers the
          interactive trail map on the hike page.
        </p>
        <input
          className="admin-input"
          type="text"
          placeholder="New hike name…"
          value={customHike}
          onChange={e => { setCustomHike(e.target.value); setGpxHikeId(''); setGpxFile(null); setGpxError(null); setGpxSaved(false) }}
        />
        <p className="admin-or">or choose a hike that already exists</p>
        <select
          className="admin-input"
          value={gpxHikeId}
          onChange={e => { setGpxHikeId(e.target.value); setCustomHike(''); setGpxFile(null); setGpxError(null); setGpxSaved(false); setGpxExistingUrl(null) }}
        >
          {/* A hike doesn't need a page yet to have a real GPX route — this
              was previously impossible to reach at all (the dropdown only
              ever listed `hikes`, the published/static list), so a route
              couldn't be attached until after publishing, backwards from how
              the Pending tab's own Create Page flow actually wants it: GPX
              uploaded first, page generated from what's already there. */}
          <HikeOptions pendingHikeIds={pendingHikeIds} />
        </select>

        {selectedGpxHikeId && (
          <GpxUploadControl
            existingUrl={gpxExistingUrl}
            file={gpxFile}
            onChooseFile={setGpxFile}
            onUpload={handleGpxSave}
            uploading={gpxSaving}
            saved={gpxSaved}
            error={gpxError}
          />
        )}
      </section>

      <section className="admin-section">
        <label className="admin-label">HIKE DATES</label>
        <p className="admin-or">Log visit dates per hike. These drive the Recent sort order on the homepage.</p>
        <select className="admin-input" value={dateHikeId} onChange={e => { setDateHikeId(e.target.value); setDateValue(''); setDateNotes(''); setDateError(null); setDateSaved(false) }}>
          <option value="">— choose a hike —</option>
          {hikes.map(h => <option key={h.id} value={h.supabaseId || h.id}>{h.name}</option>)}
        </select>

        {dateHikeId && (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 auto' }}>
                <p className="admin-or" style={{ margin: '0 0 4px' }}>Date hiked</p>
                <input
                  className="admin-input"
                  type="date"
                  value={dateValue}
                  onChange={e => setDateValue(e.target.value)}
                  style={{ width: 'auto' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <p className="admin-or" style={{ margin: '0 0 4px' }}>Notes <span className="admin-label-optional">optional</span></p>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="e.g. First snow of the season"
                  value={dateNotes}
                  onChange={e => setDateNotes(e.target.value)}
                />
              </div>
            </div>
            {dateError && <p className="admin-error">{dateError}</p>}
            {dateSaved && <p className="admin-success">Date saved!</p>}
            <button className="admin-btn-primary" onClick={handleDateSave} disabled={dateSaving || !dateValue} style={{ marginTop: '0.75rem' }}>
              {dateSaving ? 'Saving…' : 'Add Date'}
            </button>

            {existingDates.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <p className="admin-or" style={{ marginBottom: '0.5rem' }}>Logged dates for this hike</p>
                <div className="admin-gear-list">
                  {existingDates.map(d => (
                    <div key={d.id} className="admin-gear-item">
                      <div className="admin-gear-item-info">
                        <span className="admin-gear-item-name">{d.hike_date}</span>
                        {d.notes && <span className="admin-gear-item-category">{d.notes}</span>}
                      </div>
                      <div className="admin-gear-item-controls">
                        <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => handleDateDelete(d.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
