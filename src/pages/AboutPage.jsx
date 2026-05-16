import { Link } from 'react-router-dom'
import { hikes } from '../data/hikes'

export default function AboutPage() {
  return (
    <div className="about">
      <section className="about-hero">
        <h1>About The Lost Trailhead</h1>
        <p className="about-tagline">
          Thirty years of friendship, measured in elevation gain.
        </p>
      </section>

      <section className="about-story">
        <div className="about-text">
          <p>
            Scott and Alan have been friends since before GPS tracks and Instagram posts — back
            when you navigated by topo map and trusted that the weather would hold. Home base is
            the Pacific Northwest, and they've logged three decades in the Cascades through every
            season the range can throw at you: the crystal mornings of July, the larches of October,
            the shoulder-season snow that turns back most parties.
          </p>
          <p>
            But a good trail is a good trail wherever it leads. The Lost Trailhead is their shared
            archive — a place to collect the photos, remember the trails, and hold onto what it
            feels like to stand somewhere remarkable with someone who's been there from the beginning.
          </p>
        </div>
      </section>

      <section className="about-people">
        <div className="about-person">
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
        <div className="about-regions">
          {['Alpine Lakes Wilderness', 'North Cascades National Park',
            'Mount Rainier National Park', 'Okanogan-Wenatchee National Forest',
            'Red Rock-Secret Mountain Wilderness'].map((r) => (
            <span key={r} className="about-region-tag">{r}</span>
          ))}
        </div>
        <div className="about-hike-links">
          {hikes.map((hike) => (
            <Link key={hike.id} to={`/hikes/${hike.id}`} className="about-hike-link">
              <span className="about-hike-link-name">{hike.name}</span>
              <span className="about-hike-link-region">{hike.region}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
