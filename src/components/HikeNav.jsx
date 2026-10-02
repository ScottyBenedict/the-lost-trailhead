import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { hikes } from '../data/hikes'
import { supabase } from '../lib/supabase'

// Previous/next links at the foot of a hike page. Walks the same order as the
// home page's "Recent" sort: most recently hiked first, then any undated hikes
// A–Z. Renders nothing until dates load so the links don't jump from A–Z
// neighbours to date neighbours mid-read.
export default function HikeNav({ slug }) {
  const [hikeDates, setHikeDates] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('hike_dates').select('hike_id, hike_date').then(({ data }) => {
      if (cancelled) return
      const map = new Map()
      for (const row of data || []) {
        const d = new Date(row.hike_date)
        if (!map.has(row.hike_id) || d > map.get(row.hike_id)) map.set(row.hike_id, d)
      }
      setHikeDates(map)
    })
    return () => { cancelled = true }
  }, [])

  const ordered = useMemo(() => {
    if (!hikeDates) return null
    return [...hikes].sort((a, b) => {
      const aDate = hikeDates.get(a.supabaseId || a.id)
      const bDate = hikeDates.get(b.supabaseId || b.id)
      if (aDate && bDate) return bDate - aDate
      if (aDate) return -1
      if (bDate) return 1
      return a.name.localeCompare(b.name)
    })
  }, [hikeDates])

  if (!ordered) return null
  const i = ordered.findIndex(h => h.id === slug)
  if (i === -1) return null
  const prev = ordered[i - 1]
  const next = ordered[i + 1]

  return (
    <nav className={`hike-nav${prev && next ? '' : ' hike-nav-solo'}`} aria-label="More hikes">
      {prev && (
        <Link to={`/hikes/${prev.id}`} className="hike-nav-link hike-nav-prev">
          <span className="hike-nav-label">← Previous</span>
          <span className="hike-nav-name">{prev.name}</span>
        </Link>
      )}
      {prev && next && <span className="hike-nav-divider" aria-hidden="true" />}
      {next && (
        <Link to={`/hikes/${next.id}`} className="hike-nav-link hike-nav-next">
          <span className="hike-nav-label">Next →</span>
          <span className="hike-nav-name">{next.name}</span>
        </Link>
      )}
    </nav>
  )
}
