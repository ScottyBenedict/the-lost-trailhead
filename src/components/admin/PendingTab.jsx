import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { unslugify, getKnownHikeIds, uploadGpxFile } from '../../lib/adminUtils'
import TLTLogo from '../TLTLogo'
import GpxUploadControl from './GpxUploadControl'

// Escapes a value for safe embedding inside a single-quoted JS string literal
// in the generated hikes.js snippet below.
function jsStringLiteral(value) {
  return `'${(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const EMPTY_CREATE_FIELDS = { name: '', region: '', distance: '', gain: '', difficulty: 'Moderate', season: '', description: '' }

export default function PendingTab({ session }) {
  const [pendingHikes, setPendingHikes] = useState([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [expandedPendingId, setExpandedPendingId] = useState(null)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [pendingSetup, setPendingSetup] = useState({ hero_path: null, second_path: null })
  const [setupSaved, setSetupSaved] = useState(false)
  const [setupError, setSetupError] = useState(null)

  // GPX — the only other prerequisite (besides Hero/2nd) a new hike needs
  // before it can go live, so it lives in this same expanded panel rather
  // than requiring a trip to the separate Maps tab. That tab's own GPX
  // uploader only lists hikes already in hikes.js (`hikes.map(...)`), so a
  // hike still in this Pending list literally can't use it yet anyway —
  // this is the same upload/upsert logic, just scoped to the hike being
  // reviewed here. The Maps tab remains the right place to *replace* GPX
  // for an already-published hike later, and for logging hike dates, which
  // have nothing to do with first-time setup.
  const [pendingGpxUrl, setPendingGpxUrl] = useState(null)
  const [gpxFile, setGpxFile] = useState(null)
  const [gpxUploading, setGpxUploading] = useState(false)
  const [gpxError, setGpxError] = useState(null)
  const [gpxSaved, setGpxSaved] = useState(false)

  // Create-page — generates a hikes.js entry from what's already known
  // (photos, Hero/2nd picks) plus the handful of fields that only exist as
  // human-written prose and can't be pulled from anywhere in Supabase. A
  // browser-side admin panel can't commit a file to the repo itself, so this
  // produces text to paste into src/data/hikes.js by hand, not a live push.
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [createFields, setCreateFields] = useState(EMPTY_CREATE_FIELDS)
  const [createSnippet, setCreateSnippet] = useState(null)
  const [snippetCopied, setSnippetCopied] = useState(false)

  // AI-assisted field suggestions — calls the suggest-hike Edge Function
  // (server-side, holds the Anthropic key) which researches the trail and
  // returns draft values. These only ever pre-fill createFields; nothing
  // here writes anywhere on its own — Generate/paste/commit stays manual.
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState(null)

  useEffect(() => {
    if (!session) return
    async function fetchPending() {
      setLoadingPending(true)
      const knownIds = getKnownHikeIds()
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
  }, [session])

  function resetExpandedState() {
    setPendingPhotos([])
    setPendingSetup({ hero_path: null, second_path: null })
    setSetupError(null)
    setSetupSaved(false)
    setPendingGpxUrl(null)
    setGpxFile(null)
    setGpxError(null)
    setGpxSaved(false)
    setCreateFormOpen(false)
    setCreateFields(EMPTY_CREATE_FIELDS)
    setCreateSnippet(null)
    setSnippetCopied(false)
    setSuggesting(false)
    setSuggestError(null)
  }

  async function togglePendingExpand(hikeId) {
    if (expandedPendingId === hikeId) {
      setExpandedPendingId(null)
      resetExpandedState()
      return
    }
    setExpandedPendingId(hikeId)
    resetExpandedState()
    const [{ data: photoData }, { data: setupData }, { data: gpxData }] = await Promise.all([
      supabase.from('hike_photos').select('storage_path, display_order').eq('hike_id', hikeId).order('display_order'),
      supabase.from('hike_setup').select('hero_path, second_path').eq('hike_id', hikeId).maybeSingle(),
      supabase.from('hike_gpx').select('gpx_url').eq('hike_id', hikeId).maybeSingle(),
    ])
    if (photoData) {
      setPendingPhotos(photoData.map(p => ({
        storage_path: p.storage_path,
        display_order: p.display_order,
        url: supabase.storage.from('hike-photos').getPublicUrl(p.storage_path).data.publicUrl,
      })))
    }
    if (setupData) setPendingSetup({ hero_path: setupData.hero_path, second_path: setupData.second_path })
    setPendingGpxUrl(gpxData?.gpx_url || null)
  }

  async function handleSetupSave(hikeId, updates) {
    // Optimistic: the button's checkmark state comes from pendingSetup, so
    // waiting for the round trip before updating it means every click reads
    // as "nothing happened" until the request resolves — worse, `setupSaving`
    // disabling the whole grid meant a second click during that window was
    // silently dropped instead of queued, compounding the same feeling.
    // Updating state immediately and only reverting on a real failure below
    // makes each click register right away regardless of latency.
    const prevSetup = pendingSetup
    setPendingSetup(prev => ({ ...prev, ...updates }))
    setSetupError(null); setSetupSaved(false)
    try {
      const { error } = await supabase.from('hike_setup').upsert(
        { hike_id: hikeId, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'hike_id' }
      )
      if (error) throw error
      setSetupSaved(true); setTimeout(() => setSetupSaved(false), 3000)
    } catch (err) {
      setPendingSetup(prevSetup)
      setSetupError(err.message)
    }
  }

  async function handleGpxUpload(hikeId) {
    if (!gpxFile) return
    setGpxUploading(true); setGpxError(null); setGpxSaved(false)
    try {
      const gpx_url = await uploadGpxFile(hikeId, gpxFile, session.user.id)
      setPendingGpxUrl(gpx_url); setGpxFile(null)
      setGpxSaved(true); setTimeout(() => setGpxSaved(false), 4000)
    } catch (err) { setGpxError(err.message) }
    finally { setGpxUploading(false) }
  }

  function buildSnippet(hikeId) {
    const heroUrl = pendingPhotos.find(p => p.storage_path === pendingSetup.hero_path)?.url
    const galleryStart = pendingPhotos.findIndex(p => p.storage_path === pendingSetup.second_path)
    const f = createFields
    const lines = [
      `  {`,
      `    id: ${jsStringLiteral(hikeId)},`,
      `    name: ${jsStringLiteral(f.name)},`,
      `    region: ${jsStringLiteral(f.region)},`,
      `    distance: ${jsStringLiteral(f.distance)},`,
      `    gain: ${jsStringLiteral(f.gain)},`,
      `    difficulty: ${jsStringLiteral(f.difficulty)},`,
      `    season: ${jsStringLiteral(f.season)},`,
      `    description: ${jsStringLiteral(f.description)},`,
      `    cover: ${jsStringLiteral(heroUrl)},`,
      `    coverPosition: 'center 50%',`,
      `    photos: [],`,
    ]
    // Reorders the dynamically-loaded gallery to start from the "2nd" pick,
    // the same mechanism HikePage.jsx's allPhotos already applies for every
    // other hike — omitted entirely when it's 0 (the default) rather than
    // writing a no-op value.
    if (galleryStart > 0) lines.push(`    galleryStart: ${galleryStart},`)
    lines.push(`  },`)
    return lines.join('\n')
  }

  function handleGenerateSnippet(hikeId) {
    setCreateSnippet(buildSnippet(hikeId))
    setSnippetCopied(false)
  }

  async function handleCopySnippet() {
    if (!createSnippet) return
    try {
      await navigator.clipboard.writeText(createSnippet)
      setSnippetCopied(true); setTimeout(() => setSnippetCopied(false), 3000)
    } catch { /* clipboard permission denied — the textarea's own content is still selectable/copyable manually */ }
  }

  async function handleSuggestFields(hikeId) {
    const name = createFields.name || unslugify(hikeId)
    setSuggesting(true); setSuggestError(null)
    try {
      const { data, error } = await supabase.functions.invoke('suggest-hike', { body: { name } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setCreateFields(prev => ({
        ...prev,
        name: prev.name || name,
        region: data.region ?? prev.region,
        distance: data.distance ?? prev.distance,
        gain: data.gain ?? prev.gain,
        difficulty: data.difficulty ?? prev.difficulty,
        season: data.season ?? prev.season,
        description: data.description ?? prev.description,
      }))
    } catch (err) { setSuggestError(err.message) }
    finally { setSuggesting(false) }
  }

  return (
    <main className="admin-main">
      {loadingPending ? <p className="admin-or">Loading…</p> : pendingHikes.length === 0 ? (
        <div className="admin-pending-empty">
          <TLTLogo size={240} color="#c4c0b8" />
          <p className="admin-pending-empty-title">You're done here.</p>
          <p className="admin-pending-empty-sub">Every hike has a page. Don't worry — Alan is definitely already planning something you'll regret saying yes to.</p>
        </div>
      ) : (
        <div className="admin-pending-list">
          {pendingHikes.map(h => {
            const isExpanded = expandedPendingId === h.hike_id
            const readyToCreate = Boolean(pendingSetup.hero_path && pendingSetup.second_path)
            return (
              <div key={h.hike_id} className="admin-pending-item">
                <div className="admin-pending-item-header" onClick={() => togglePendingExpand(h.hike_id)}>
                  <div>
                    <p className="admin-pending-name">{unslugify(h.hike_id)}</p>
                    <p className="admin-pending-meta">
                      {h.photos} photo{h.photos !== 1 ? 's' : ''}
                      {h.reports > 0 && ` · ${h.reports} report${h.reports !== 1 ? 's' : ''}`}
                      {h.submitters.length > 0 && ` · ${h.submitters.join(', ')}`}
                    </p>
                    <p className="admin-pending-slug">{h.hike_id}</p>
                  </div>
                  <span className="admin-pending-chevron">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div className="admin-pending-photos">
                    {pendingPhotos.length === 0 ? (
                      <p className="admin-or" style={{ padding: '1rem 0' }}>Loading photos…</p>
                    ) : (
                      <>
                        <div className="admin-pending-photo-grid">
                          {pendingPhotos.map(photo => {
                            const isHero = pendingSetup.hero_path === photo.storage_path
                            const isSecond = pendingSetup.second_path === photo.storage_path
                            return (
                              <div
                                key={photo.storage_path}
                                className={`admin-pending-photo${isHero ? ' is-hero' : isSecond ? ' is-second' : ''}`}
                              >
                                <div className="admin-pending-photo-num">{photo.display_order + 1}</div>
                                <img src={photo.url} alt={`Photo ${photo.display_order + 1}`} loading="lazy" />
                                {isHero && <div className="admin-pending-photo-badge">Hero</div>}
                                {isSecond && <div className="admin-pending-photo-badge admin-pending-photo-badge-second">2nd</div>}
                                <div className="admin-pending-photo-btns">
                                  <button
                                    className={`admin-gear-ctrl${isHero ? ' admin-gear-ctrl-active' : ''}`}
                                    onClick={() => handleSetupSave(h.hike_id, { hero_path: photo.storage_path })}
                                  >
                                    {isHero ? 'Hero ✓' : 'Set Hero'}
                                  </button>
                                  <button
                                    className={`admin-gear-ctrl${isSecond ? ' admin-gear-ctrl-active' : ''}`}
                                    onClick={() => handleSetupSave(h.hike_id, { second_path: photo.storage_path })}
                                  >
                                    {isSecond ? '2nd ✓' : 'Set 2nd'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        {setupError && <p className="admin-error">{setupError}</p>}
                        {setupSaved && <p className="admin-success">Saved!</p>}
                        {(pendingSetup.hero_path || pendingSetup.second_path) && (
                          <div className="admin-pending-summary">
                            {pendingSetup.hero_path && (
                              <span>Hero: photo {pendingPhotos.findIndex(p => p.storage_path === pendingSetup.hero_path) + 1}</span>
                            )}
                            {pendingSetup.hero_path && pendingSetup.second_path && <span className="dot" />}
                            {pendingSetup.second_path && (
                              <span>2nd: photo {pendingPhotos.findIndex(p => p.storage_path === pendingSetup.second_path) + 1}</span>
                            )}
                          </div>
                        )}

                        <div className="admin-pending-gpx">
                          <label className="admin-label">GPX ROUTE</label>
                          <GpxUploadControl
                            existingUrl={pendingGpxUrl}
                            file={gpxFile}
                            onChooseFile={setGpxFile}
                            onUpload={() => handleGpxUpload(h.hike_id)}
                            uploading={gpxUploading}
                            saved={gpxSaved}
                            error={gpxError}
                          />
                        </div>

                        <div className="admin-pending-create">
                          {!createFormOpen ? (
                            <button
                              className="admin-btn-primary"
                              disabled={!readyToCreate}
                              title={readyToCreate ? undefined : 'Pick both a Hero and 2nd photo first'}
                              onClick={() => {
                                setCreateFormOpen(true)
                                setCreateFields(prev => ({ ...prev, name: prev.name || unslugify(h.hike_id) }))
                              }}
                            >
                              Create Page →
                            </button>
                          ) : (
                            <>
                              <label className="admin-label">CREATE PAGE</label>
                              <p className="admin-or">
                                Fills in everything already known (photos, Hero/2nd, GPX) — these are the only
                                fields nobody but you can write.
                              </p>
                              <button
                                className="admin-btn-ghost"
                                onClick={() => handleSuggestFields(h.hike_id)}
                                disabled={suggesting}
                                style={{ marginTop: '0.5rem' }}
                              >
                                {suggesting ? 'Researching…' : 'Suggest with AI ✨'}
                              </button>
                              {suggestError && <p className="admin-error">{suggestError}</p>}
                              {[
                                ['name', 'Name', 'e.g. Little Si'],
                                ['region', 'Region', 'e.g. Mount Si NRCA · North Bend'],
                                ['distance', 'Distance', 'e.g. 4.7 mi'],
                                ['gain', 'Elevation Gain', 'e.g. 1,300 ft'],
                                ['season', 'Best Season', 'e.g. Year-round'],
                              ].map(([key, label, placeholder]) => (
                                <div key={key} style={{ marginTop: '0.75rem' }}>
                                  <p className="admin-or" style={{ margin: '0 0 4px' }}>{label}</p>
                                  <input
                                    className="admin-input"
                                    type="text"
                                    placeholder={placeholder}
                                    value={createFields[key]}
                                    onChange={e => setCreateFields(prev => ({ ...prev, [key]: e.target.value }))}
                                  />
                                </div>
                              ))}
                              <div style={{ marginTop: '0.75rem' }}>
                                <p className="admin-or" style={{ margin: '0 0 4px' }}>Difficulty</p>
                                <select
                                  className="admin-input"
                                  value={createFields.difficulty}
                                  onChange={e => setCreateFields(prev => ({ ...prev, difficulty: e.target.value }))}
                                >
                                  {['Easy', 'Moderate', 'Strenuous'].map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                              </div>
                              <div style={{ marginTop: '0.75rem' }}>
                                <p className="admin-or" style={{ margin: '0 0 4px' }}>Description</p>
                                <textarea
                                  className="admin-input"
                                  rows={4}
                                  placeholder="A couple sentences for the hike page body."
                                  value={createFields.description}
                                  onChange={e => setCreateFields(prev => ({ ...prev, description: e.target.value }))}
                                />
                              </div>

                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                <button className="admin-btn-ghost" onClick={() => { setCreateFormOpen(false); setCreateSnippet(null); setSuggestError(null) }}>
                                  Cancel
                                </button>
                                <button
                                  className="admin-btn-primary"
                                  disabled={!createFields.name || !createFields.region || !createFields.description}
                                  onClick={() => handleGenerateSnippet(h.hike_id)}
                                >
                                  Generate
                                </button>
                              </div>

                              {createSnippet && (
                                <div style={{ marginTop: '1rem' }}>
                                  <p className="admin-or" style={{ margin: '0 0 4px' }}>
                                    Paste this into src/data/hikes.js, then commit &amp; deploy — this hike drops
                                    off this Pending list automatically once its id matches a known hike.
                                  </p>
                                  <textarea className="admin-input" readOnly rows={12} value={createSnippet} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
                                  <button className="admin-btn-ghost" style={{ marginTop: '0.5rem' }} onClick={handleCopySnippet}>
                                    {snippetCopied ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
