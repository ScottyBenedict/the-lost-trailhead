import { useState, useEffect, useMemo } from 'react'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'
import HikeCard from '../components/HikeCard'

export default function HomePage() {
  const [sortMode, setSortMode] = useState('az')
  const [hikeDates, setHikeDates] = useState(new Map())
  // "Recent" sorts by hikeDates, fetched async — clicking it before this
  // resolves silently falls back to alphabetical (every hike looks
  // date-less), indistinguishable from A-Z. It self-corrects the instant
  // the fetch lands, but on a slow connection that window is long enough
  // for a real click to land in it and look completely broken (worse: since
  // both modes then render the same list, toggling back to A-Z looks like
  // it does nothing too). Disabling Recent until dates are in avoids the
  // race outright instead of racing to fix the symptom.
  const [datesLoaded, setDatesLoaded] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const { data: dateData } = await supabase.from('hike_dates').select('hike_id, hike_date')
      if (dateData) {
        const map = new Map()
        for (const row of dateData) {
          const d = new Date(row.hike_date)
          if (!map.has(row.hike_id) || d > map.get(row.hike_id)) map.set(row.hike_id, d)
        }
        setHikeDates(map)
      }
      setDatesLoaded(true)
    }
    fetchData()
  }, [])

  const sorted = useMemo(() => {
    return [...hikes].sort((a, b) => {
      if (sortMode === 'az') return a.name.localeCompare(b.name)
      const aDate = hikeDates.get(a.supabaseId || a.id)
      const bDate = hikeDates.get(b.supabaseId || b.id)
      if (aDate && bDate) return bDate - aDate
      if (aDate) return -1
      if (bDate) return 1
      return a.name.localeCompare(b.name)
    })
  }, [sortMode, hikeDates])

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <p className="hero-eyebrow">Based in the Pacific Northwest</p>
          <h1 className="hero-title">
            Two good friends.<br />
            We've done the miles together,<br />
            here's what we found.
          </h1>
          <p className="hero-sub">
            A record of the trails, the views, and the conversations in between.
          </p>
        </div>
        <div className="hero-scroll-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      <section className="hikes-section">
        <div className="sort-toggle">
          <button
            className={`sort-btn${sortMode === 'az' ? ' sort-btn-active' : ''}`}
            onClick={() => setSortMode('az')}
          >
            A–Z
          </button>
          <button
            className={`sort-btn${sortMode === 'recent' ? ' sort-btn-active' : ''}`}
            onClick={() => setSortMode('recent')}
            disabled={!datesLoaded}
            title={datesLoaded ? undefined : 'Loading hike dates…'}
          >
            Recent
          </button>
        </div>
        <div className="hike-grid">
          {sorted.map((hike) => (
            <HikeCard key={hike.id} hike={hike} />
          ))}
        </div>
      </section>
    </>
  )
}
