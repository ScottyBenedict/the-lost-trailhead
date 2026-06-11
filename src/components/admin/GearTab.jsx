import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const GEAR_CATEGORIES = ['Footwear','Shell','Pack','Watch','Phone/Camera','Poles','Gaiters','Gloves','Headlamp','Sunglasses','Baselayer','Midlayer','Pants','Tent','Stove','Sleeping Bag','Pad','Navigation','Accessories']

export default function GearTab({ session }) {
  const [gearItems, setGearItems] = useState([])
  const [loadingGear, setLoadingGear] = useState(false)
  const [gearForm, setGearForm] = useState(null)
  const [editingGearId, setEditingGearId] = useState(null)
  const [gearSaving, setGearSaving] = useState(false)
  const [gearError, setGearError] = useState(null)
  const [gearDeleteConfirm, setGearDeleteConfirm] = useState(null)

  useEffect(() => {
    loadGear()
  }, [])

  async function loadGear() {
    setLoadingGear(true)
    const { data } = await supabase.from('gear_items').select('*').eq('user_id', session.user.id).order('sort_order')
    setGearItems(data || [])
    setLoadingGear(false)
  }

  function openGearForm(item = null) {
    setGearError(null)
    if (item) {
      setGearForm({ category: item.category, brand: item.brand, name: item.name, description: item.description })
      setEditingGearId(item.id)
    } else {
      setGearForm({ category: '', brand: '', name: '', description: '' })
      setEditingGearId(null)
    }
  }

  function closeGearForm() { setGearForm(null); setEditingGearId(null); setGearError(null) }

  async function saveGearItem() {
    if (!gearForm.category.trim() || !gearForm.name.trim()) { setGearError('Category and model are required.'); return }
    setGearSaving(true); setGearError(null)
    try {
      if (editingGearId) {
        const { error } = await supabase.from('gear_items').update({
          category: gearForm.category.trim(), brand: gearForm.brand.trim(),
          name: gearForm.name.trim(), description: gearForm.description.trim(),
        }).eq('id', editingGearId).eq('user_id', session.user.id)
        if (error) throw error
      } else {
        const maxOrder = gearItems.length > 0 ? Math.max(...gearItems.map(i => i.sort_order)) : -1
        const { error } = await supabase.from('gear_items').insert({
          user_id: session.user.id, category: gearForm.category.trim(), brand: gearForm.brand.trim(),
          name: gearForm.name.trim(), description: gearForm.description.trim(), sort_order: maxOrder + 1,
        })
        if (error) throw error
      }
      await loadGear()
      closeGearForm()
    } catch (err) { setGearError(err.message) }
    finally { setGearSaving(false) }
  }

  async function deleteGearItem(id) {
    const { error } = await supabase.from('gear_items').delete().eq('id', id).eq('user_id', session.user.id)
    if (!error) { setGearItems(prev => prev.filter(i => i.id !== id)); setGearDeleteConfirm(null) }
  }

  async function moveGearItem(id, direction) {
    const idx = gearItems.findIndex(i => i.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= gearItems.length) return
    const a = gearItems[idx]; const b = gearItems[swapIdx]
    await Promise.all([
      supabase.from('gear_items').update({ sort_order: b.sort_order }).eq('id', a.id).eq('user_id', session.user.id),
      supabase.from('gear_items').update({ sort_order: a.sort_order }).eq('id', b.id).eq('user_id', session.user.id),
    ])
    await loadGear()
  }

  return (
    <main className="admin-main">
      <section className="admin-section">
        <label className="admin-label">YOUR GEAR</label>
        {loadingGear ? (
          <p className="admin-or">Loading…</p>
        ) : (
          <>
            {gearItems.length === 0 && !gearForm && (
              <p className="admin-or">No gear items yet — add your first item below.</p>
            )}
            <div className="admin-gear-list">
              {gearItems.map((item, idx) => (
                <div key={item.id} className="admin-gear-item">
                  {gearDeleteConfirm === item.id ? (
                    <div className="admin-gear-delete-confirm">
                      <span>Delete {item.brand ? `${item.brand} ` : ''}{item.name}?</span>
                      <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => deleteGearItem(item.id)}>Yes, delete</button>
                      <button className="admin-gear-ctrl" onClick={() => setGearDeleteConfirm(null)}>Cancel</button>
                    </div>
                  ) : editingGearId === item.id ? (
                    <div className="admin-gear-form">
                      <div className="admin-gear-form-row">
                        <select className="admin-input" value={gearForm.category} onChange={e => setGearForm(f => ({ ...f, category: e.target.value }))}>
                          <option value="">— Category —</option>
                          {GEAR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input className="admin-input" placeholder="Brand" value={gearForm.brand} onChange={e => setGearForm(f => ({ ...f, brand: e.target.value }))} />
                      </div>
                      <input className="admin-input" placeholder="Model" value={gearForm.name} onChange={e => setGearForm(f => ({ ...f, name: e.target.value }))} />
                      <textarea className="admin-textarea" rows={2} placeholder="Description (optional)" value={gearForm.description} onChange={e => setGearForm(f => ({ ...f, description: e.target.value }))} />
                      {gearError && <p className="admin-error">{gearError}</p>}
                      <div className="admin-gear-form-actions">
                        <button className="admin-btn-primary" onClick={saveGearItem} disabled={gearSaving}>{gearSaving ? 'Saving…' : 'Save'}</button>
                        <button className="admin-btn-ghost" onClick={closeGearForm}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="admin-gear-item-info">
                        <span className="admin-gear-item-category">{item.category}</span>
                        <span className="admin-gear-item-name">
                          {item.brand && <span className="admin-gear-item-brand">{item.brand} · </span>}
                          {item.name}
                        </span>
                      </div>
                      <div className="admin-gear-item-controls">
                        <button className="admin-gear-ctrl" onClick={() => moveGearItem(item.id, 'up')} disabled={idx === 0} title="Move up">↑</button>
                        <button className="admin-gear-ctrl" onClick={() => moveGearItem(item.id, 'down')} disabled={idx === gearItems.length - 1} title="Move down">↓</button>
                        <button className="admin-gear-ctrl" onClick={() => openGearForm(item)}>Edit</button>
                        <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => setGearDeleteConfirm(item.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {gearForm && !editingGearId && (
              <div className="admin-gear-form admin-gear-form-add">
                <label className="admin-label">ADD ITEM</label>
                <div className="admin-gear-form-row">
                  <select className="admin-input" value={gearForm.category} onChange={e => setGearForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">— Category —</option>
                    {GEAR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="admin-input" placeholder="Brand" value={gearForm.brand} onChange={e => setGearForm(f => ({ ...f, brand: e.target.value }))} />
                </div>
                <input className="admin-input" placeholder="Model" value={gearForm.name} onChange={e => setGearForm(f => ({ ...f, name: e.target.value }))} />
                <textarea className="admin-textarea" rows={2} placeholder="Description (optional)" value={gearForm.description} onChange={e => setGearForm(f => ({ ...f, description: e.target.value }))} />
                {gearError && <p className="admin-error">{gearError}</p>}
                <div className="admin-gear-form-actions">
                  <button className="admin-btn-primary" onClick={saveGearItem} disabled={gearSaving}>{gearSaving ? 'Saving…' : 'Add Item'}</button>
                  <button className="admin-btn-ghost" onClick={closeGearForm}>Cancel</button>
                </div>
              </div>
            )}

            {!gearForm && (
              <button className="admin-btn-ghost admin-gear-add-btn" onClick={() => openGearForm()}>+ Add Item</button>
            )}
          </>
        )}
      </section>
    </main>
  )
}
