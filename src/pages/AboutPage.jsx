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
            when you navigated by topo map and trusted that the weather would hold. They've been
            hiking the Pacific Northwest together for three decades, through every season the
            Cascades can throw at you: the crystal mornings of July, the larches of October,
            the shoulder-season snow that turns back most parties.
          </p>
          <p>
            The Lost Trailhead is their shared archive — a place to collect the photos, remember the
            trails, and hold onto what it feels like to stand above treeline with someone who's
            been there from the beginning.
          </p>
        </div>
      </section>

      <section className="about-people">
        <div className="about-person">
          <h2>Scott</h2>
          <p>
            Scott grew up in the Pacific Northwest and has spent decades exploring Washington's
            backcountry. Equal parts photographer and trail scout, he has a talent for finding
            the frame that makes a familiar scene feel entirely new.
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
          From the granite towers of the Teanaway to the volcanic meadows of Mount Rainier,
          these are the places we keep returning to.
        </p>
        <div className="about-regions">
          {['Alpine Lakes Wilderness', 'North Cascades National Park',
            'Mount Rainier National Park', 'Okanogan-Wenatchee National Forest'].map((r) => (
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
