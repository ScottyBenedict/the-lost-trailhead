import { people, brands } from '../data/gear'

function groupByCategory(gearList) {
  return gearList.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})
}

export default function GearPage() {
  return (
    <div className="gear-page">
      <section className="gear-hero">
        <div className="gear-hero-inner">
          <p className="hero-eyebrow">What we carry</p>
          <h1 className="gear-title">The Kit</h1>
          <p className="gear-sub">
            Thirty years of trial and error distilled into what actually makes it into the pack.
          </p>
        </div>
      </section>

      <section className="gear-section">
        <div className="gear-columns">
          {people.map(person => {
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
                            <span className="gear-item-name">{item.name}</span>
                            <span className="gear-item-brand">{item.brand}</span>
                          </div>
                          <p className="gear-item-desc">{item.description}</p>
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
            <div key={brand} className="gear-brand-logo">
              <span>{brand}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
