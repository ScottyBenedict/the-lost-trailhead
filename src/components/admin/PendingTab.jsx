import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hikes } from '../../data/hikes'
import { unslugify } from '../../lib/adminUtils'
import TLTLogo from '../TLTLogo'

export default function PendingTab({ session }) {
  const [pendingHikes, setPendingHikes] = useState([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [expandedPendingId, setExpandedPendingId] = useState(null)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [pendingSetup, setPendingSetup] = useState({ hero_path: null, second_path: null })
  const [setupSaving, setSetupSaving] = useState(false)
  const [setupSaved, setSetupSaved] = useState(false)
  const [setupError, setSetupError] = useState(null)

  useEffect(() => {
    if (!session) return
    async function fetchPending() {
      setLoadingPending(true)
      const knownIds = new Set([...hikes.map(h => h.id), ...hikes.filter(h => h.supabaseId).map(h => h.supabaseId)])
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

  async function togglePendingExpand(hikeId) {
    if (expandedPendingId === hikeId) {
      setExpandedPendingId(null)
      setPendingPhotos([])
      setPendingSetup({ hero_path: null, second_path: null })
      return
    }
    setExpandedPendingId(hikeId)
    setPendingPhotos([])
    setPendingSetup({ hero_path: null, second_path: null })
    setSetupError(null)
    setSetupSaved(false)
    const [{ data: photoData }, { data: setupData }] = await Promise.all([
      supabase.from('hike_photos').select('storage_path, display_order').eq('hike_id', hikeId).order('display_order'),
      supabase.from('hike_setup').select('hero_path, second_path').eq('hike_id', hikeId).maybeSingle(),
    ])
    if (photoData) {
      setPendingPhotos(photoData.map(p => ({
        storage_path: p.storage_path,
        display_order: p.display_order,
        url: supabase.storage.from('hike-photos').getPublicUrl(p.storage_path).data.publicUrl,
      })))
    }
    if (setupData) setPendingSetup({ hero_path: setupData.hero_path, second_path: setupData.second_path })
  }

  async function handleSetupSave(hikeId, updates) {
    setSetupSaving(true); setSetupError(null); setSetupSaved(false)
    try {
      const { error } = await supabase.from('hike_setup').upsert(
        { hike_id: hikeId, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'hike_id' }
      )
      if (error) throw error
      setPendingSetup(prev => ({ ...prev, ...updates }))
      setSetupSaved(true); setTimeout(() => setSetupSaved(false), 3000)
    } catch (err) { setSetupError(err.message) }
    finally { setSetupSaving(false) }
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
                                    disabled={setupSaving}
                                  >
                                    {isHero ? 'Hero ✓' : 'Set Hero'}
                                  </button>
                                  <button
                                    className={`admin-gear-ctrl${isSecond ? ' admin-gear-ctrl-active' : ''}`}
                                    onClick={() => handleSetupSave(h.hike_id, { second_path: photo.storage_path })}
                                    disabled={setupSaving}
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
