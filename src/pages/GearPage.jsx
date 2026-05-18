import { useState, useEffect } from 'react'
import { publicSupabase as supabase } from '../lib/supabase'
import { brands } from '../data/gear'
import TLTLogo from '../components/TLTLogo'

function groupByCategory(gearList) {
  return gearList.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})
}

// Alan first, Scott second
const PERSON_ORDER = [
  'dd5d9dfd-2613-46d9-962a-e116bf5ba145',
  '4d781942-cee2-4a99-ba03-aeb06eef81d1',
]

export default function GearPage() {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadGear() {
      const [{ data: items }, { data: profiles }] = await Promise.all([
        supabase.from('gear_items').select('*').order('sort_order'),
        supabase.from('profiles').select('id, display_name'),
      ])
      if (!items || !profiles) { setLoading(false); return }

      const profileMap = Object.fromEntries((profiles).map(p => [p.id, p]))
      const byUser = {}
      for (const item of items) {
        if (!byUser[item.user_id]) byUser[item.user_id] = []
        byUser[item.user_id].push(item)
      }

      const result = PERSON_ORDER
        .filter(uid => profileMap[uid])
        .map(uid => ({ name: profileMap[uid].display_name, gear: byUser[uid] || [] }))

      setPeople(result)
      setLoading(false)
    }
    loadGear()
  }, [])

  return (
    <div className="gear-page">
      <section className="gear-hero">
        <div className="gear-hero-inner">
          <p className="hero-eyebrow">What we carry</p>
          <h1 className="gear-title">The Kit</h1>
          <p className="gear-sub">
            Our time in the mountains started strapped to a board, going down. Now we go up too. Either direction, the obsession with getting the gear right has never changed.
          </p>
        </div>
        <div className="gear-hero-logo">
          <TLTLogo size={200} color="var(--white)" />
        </div>
      </section>

      <section className="gear-section">
        <div className="gear-section-logo">
          <TLTLogo size={180} color="var(--forest)" />
        </div>
        <div className="gear-columns">
          {loading ? (
            <p style={{ padding: '2rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: '0.85rem' }}>Loading…</p>
          ) : people.map(person => {
            const grouped = groupByCategory(person.gear)
            return (
              <div key={person.name} className="gear-person">
                <h2 className="gear-person-name">{person.name}</h2>
                {Object.entries(grouped).map(([category, items]) => (
                  <div key={category} className="gear-category">
                    <h3 className="gear-category-label">{category}</h3>
                    <ul className="gear-list">
                      {items.map((item, i) => (
                        <li key={i} className="gear-item">
                          <div className="gear-item-header">
                            <span className="gear-item-brand">{item.brand}</span>
                            <span className="gear-item-name">{item.name}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      <section className="gear-brands">
        <h2 className="gear-brands-title">Brands We Trust</h2>
        <div className="gear-brands-grid">
          {brands.map(brand => (
            <div key={brand.name} className="gear-brand-logo">
              <img src={brand.logo} alt={brand.name} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
