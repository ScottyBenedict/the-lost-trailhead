import { useState, useEffect, useMemo } from 'react'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'
import HikeCard from '../components/HikeCard'

export default function HomePage() {
  const [sortMode, setSortMode] = useState('recent')
  const [hikeDates, setHikeDates] = useState(new Map())

  useEffect(() => {
    async function fetchDates() {
      const { data } = await supabase.from('hike_dates').select('hike_id, hike_date')
      if (!data) return
      const map = new Map()
      for (const row of data) {
        const d = new Date(row.hike_date)
        if (!map.has(row.hike_id) || d > map.get(row.hike_id)) {
          map.set(row.hike_id, d)
        }
      }
      setHikeDates(map)
    }
    fetchDates()
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
            className={`sort-btn${sortMode === 'recent' ? ' sort-btn-active' : ''}`}
            onClick={() => setSortMode('recent')}
          >
            Recent
          </button>
          <button
            className={`sort-btn${sortMode === 'az' ? ' sort-btn-active' : ''}`}
            onClick={() => setSortMode('az')}
          >
            A–Z
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
