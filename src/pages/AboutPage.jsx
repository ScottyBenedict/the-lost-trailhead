import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { hikes } from '../data/hikes'
import { publicSupabase as supabase } from '../lib/supabase'
import TLTLogo from '../components/TLTLogo'

// Alan first, Scott second
const PERSON_ORDER = [
  'dd5d9dfd-2613-46d9-962a-e116bf5ba145',
  '4d781942-cee2-4a99-ba03-aeb06eef81d1',
]

export default function AboutPage() {
  const [profiles, setProfiles] = useState([])

  useEffect(() => {
    async function loadProfiles() {
      const { data } = await supabase.from('profiles').select('id, display_name, bio_text, avatar_url')
      if (!data) return
      const profileMap = Object.fromEntries(data.map(p => [p.id, p]))
      setProfiles(PERSON_ORDER.filter(uid => profileMap[uid]).map(uid => profileMap[uid]))
    }
    loadProfiles()
  }, [])

  return (
    <div className="about">
      <section className="about-hero">
        <p className="hero-eyebrow">Who we are</p>
        <h1>The People</h1>
        <p className="about-tagline">
          Alan and Scott — thirty years of friendship, still chasing new trails.
        </p>
        <div className="about-hero-logo">
          <TLTLogo size={200} color="var(--white)" />
        </div>
      </section>

      <section className="about-story">
        <div className="about-story-inner">
          <div className="about-text">
            <p>
              The Lost Trailhead started the way most good ideas do — somewhere between a summit
              and a parking lot, probably during a discussion about whether those clouds on the
              horizon were "building" or "just passing through."
            </p>
            <p>
              We're Alan and Scott. We've been hiking together long enough to know that "oh it's
              just right over there" almost always means another hour. Most of these trails are in the Cascades — our
              backyard, the range we keep coming back to through every season it can throw at you.
            </p>
            <p>
              This is our shared archive. The photos, the trip reports, the honest takes on what's
              worth the drive and what isn't — collected here so we don't forget what it felt like
              to be somewhere worth remembering.
            </p>
          </div>
          <div className="about-story-logo">
            <TLTLogo size={110} color="var(--forest)" />
          </div>
        </div>
      </section>

      <section className="about-people">
        {profiles.map(person => (
          <div key={person.id} className="about-person">
            {person.avatar_url && (
              <img src={person.avatar_url} alt={person.display_name} className="about-person-avatar" />
            )}
            <h2>{person.display_name}</h2>
            {person.bio_text
              ? person.bio_text.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
              : null
            }
          </div>
        ))}
      </section>

      <section className="about-regions-section">
        <h2>The Range</h2>
        <p>
          Home is the Cascades, but the list keeps growing. From Washington's granite ridgelines
          to the red rock canyons of the Southwest — these are the places we keep coming back to.
        </p>
        <div className="about-range-grid">
          <div className="about-range-col">
            <h3 className="about-range-heading">Where We've Been</h3>
            <div className="about-range-tags">
              {hikes.map((hike) => (
                <Link key={hike.id} to={`/hikes/${hike.id}`} className="about-range-tag about-range-tag-link">{hike.name}</Link>
              ))}
            </div>
          </div>
          <div className="about-range-col">
            <h3 className="about-range-heading">Where We're Going Next</h3>
            <div className="about-range-tags">
              {[
                'Mt. Washington', 'Lake Ann', 'Mt. Baldy', 'Sourdough Mountain',
                'Minotaur Lake', 'Maple Pass', 'Robin Lakes', 'Green Mountain',
                'Vesper Peak', 'Smutwood Peak, Alberta', 'Mt. Pilchuck',
                'Mt. Dickerman', 'Sahale Glacier', 'Eagle Lake — Sawtooths',
              ].map(h => (
                <span key={h} className="about-range-tag">{h}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
