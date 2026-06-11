import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { hikes } from '../../data/hikes'

export default function MapsTab({ session }) {
  const [gpxHikeId, setGpxHikeId] = useState('')
  const [gpxFile, setGpxFile] = useState(null)
  const [gpxExistingUrl, setGpxExistingUrl] = useState(null)
  const [gpxSaving, setGpxSaving] = useState(false)
  const [gpxSaved, setGpxSaved] = useState(false)
  const [gpxError, setGpxError] = useState(null)
  const gpxFileInputRef = useRef()

  const [dateHikeId, setDateHikeId] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [dateNotes, setDateNotes] = useState('')
  const [existingDates, setExistingDates] = useState([])
  const [dateSaving, setDateSaving] = useState(false)
  const [dateSaved, setDateSaved] = useState(false)
  const [dateError, setDateError] = useState(null)

  useEffect(() => {
    if (!gpxHikeId || !session) { setGpxExistingUrl(null); return }
    supabase.from('hike_gpx').select('gpx_url').eq('hike_id', gpxHikeId).maybeSingle()
      .then(({ data }) => setGpxExistingUrl(data?.gpx_url || null))
  }, [gpxHikeId, session])

  useEffect(() => {
    if (!dateHikeId || !session) { setExistingDates([]); return }
    supabase.from('hike_dates').select('id, hike_date, notes').eq('hike_id', dateHikeId).order('hike_date', { ascending: false })
      .then(({ data }) => setExistingDates(data || []))
  }, [dateHikeId, session])

  async function handleGpxSave() {
    if (!gpxHikeId || !gpxFile) return
    setGpxSaving(true); setGpxError(null); setGpxSaved(false)
    try {
      const path = `${gpxHikeId}.gpx`
      const { error: uploadError } = await supabase.storage.from('gpx-files').upload(path, gpxFile, { contentType: 'application/gpx+xml', upsert: true })
      if (uploadError) throw uploadError
      const gpx_url = supabase.storage.from('gpx-files').getPublicUrl(path).data.publicUrl
      const { error: upsertError } = await supabase.from('hike_gpx').upsert({
        hike_id: gpxHikeId, gpx_url, uploaded_by: session.user.id, uploaded_at: new Date().toISOString(),
      }, { onConflict: 'hike_id' })
      if (upsertError) throw upsertError
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
        <p className="admin-or">Select a hike, then upload its GPX file. This powers the interactive trail map on the hike page.</p>
        <select className="admin-input" value={gpxHikeId} onChange={e => { setGpxHikeId(e.target.value); setGpxFile(null); setGpxError(null); setGpxSaved(false); setGpxExistingUrl(null) }}>
          <option value="">— choose a hike —</option>
          {hikes.map(h => <option key={h.id} value={h.supabaseId || h.id}>{h.name}</option>)}
        </select>

        {gpxHikeId && (
          <>
            {gpxExistingUrl && (
              <div className="admin-flag admin-flag-info">
                A GPX file already exists for this hike — uploading will replace it.
              </div>
            )}
            <input
              ref={gpxFileInputRef}
              type="file"
              accept=".gpx,application/gpx+xml"
              style={{ display: 'none' }}
              onChange={e => { setGpxFile(e.target.files[0] || null); e.target.value = '' }}
            />
            <button className="admin-btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => gpxFileInputRef.current.click()}>
              {gpxFile ? gpxFile.name : 'Choose GPX file…'}
            </button>
          </>
        )}

        {gpxError && <p className="admin-error">{gpxError}</p>}
        {gpxSaved && <p className="admin-success">GPX uploaded!</p>}
        {gpxHikeId && (
          <button className="admin-btn-primary" onClick={handleGpxSave} disabled={gpxSaving || !gpxFile} style={{ marginTop: '1rem' }}>
            {gpxSaving ? 'Uploading…' : 'Upload GPX'}
          </button>
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
