import { Link } from 'react-router-dom'
import { hikes } from '../data/hikes'

export default function AboutPage() {
  return (
    <div className="about">
      <section className="about-hero">
        <p className="hero-eyebrow">Who we are</p>
        <h1>The Lost Trailhead</h1>
        <p className="about-tagline">
          Thirty years of friendship, measured in elevation gain.
        </p>
      </section>

      <section className="about-story">
        <div className="about-text">
          <p>
            The Lost Trailhead started the way most good ideas do — somewhere between a summit
            and a parking lot, probably during a discussion about whether those clouds on the
            horizon were "building" or "just passing through."
          </p>
          <p>
            We're Scott and Alan. We've been hiking together long enough to know that "oh it's
            just right over there" almost always means another hour. Most of these trails are in the Cascades — our
            backyard, the range we keep coming back to through every season it can throw at you.
          </p>
          <p>
            This is our shared archive. The photos, the trip reports, the honest takes on what's
            worth the drive and what isn't — collected here so we don't forget what it felt like
            to be somewhere worth remembering.
          </p>
        </div>
      </section>

      <section className="about-people">
        <div className="about-person">
          <img src="/photos/scott-profile.jpeg" alt="Scott" className="about-person-avatar" />
          <h2>Scott</h2>
          <p>
            I'm Scott — a Pacific Northwest hiker, average photographer, lifelong snowboarder,
            and former skateboard kid who still occasionally forgets he's too old to be trying kickflips.
          </p>
          <p>
            Between work, time with my two kids, and trying to be the first Subaru at the trailhead
            on hike days, I spend as much time outside as I can — usually somewhere in the Cascades
            chasing alpine lakes, mountain light, and trails that looked like they had a lot less
            elevation gain online the night before. I also have a well-documented weakness for
            technical outdoor gear, which is how I've somehow convinced myself that owning "just
            one more layer" is always a reasonable decision.
          </p>
          <p>
            Most of these hikes started as a way for my buddy Alan and me to escape cell service
            for a few hours, clear our heads, catch up on life, and convince ourselves the weather
            forecast was wrong. Somewhere along the way — between the views, the conversations,
            and a growing collection of photos on our phones — the idea for The Lost Trailhead
            was born.
          </p>
          <p>
            I can't claim to be a professional photographer or elite mountaineer — just a guy who
            loves wild places, early trailhead starts, and documenting the moments that make sore
            legs and occasional wet gear worth it.
          </p>
        </div>
        <div className="about-person">
          <h2>Alan</h2>
          <p>
            Alan brings a careful eye and a willingness to go one more ridge over just to see
            what's there. A thirty-year friendship's worth of judgment calls — and he's
            almost always right about the weather.
          </p>
        </div>
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
