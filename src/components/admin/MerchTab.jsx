import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { processFiles, formatPrice } from '../../lib/adminUtils'

export default function MerchTab() {
  const [merchProducts, setMerchProducts] = useState([])
  const [loadingMerch, setLoadingMerch] = useState(false)
  const [merchForm, setMerchForm] = useState(null)
  const [editingMerchId, setEditingMerchId] = useState(null)
  const [merchImages, setMerchImages] = useState([])
  const [isDragOverMerch, setIsDragOverMerch] = useState(false)
  const [merchSaving, setMerchSaving] = useState(false)
  const [merchError, setMerchError] = useState(null)
  const [showArchivedMerch, setShowArchivedMerch] = useState(false)
  const [merchDeleteConfirm, setMerchDeleteConfirm] = useState(null)
  const merchImageInputRef = useRef()

  useEffect(() => {
    loadMerch()
  }, [])

  async function loadMerch() {
    setLoadingMerch(true)
    const { data } = await supabase.from('merch_products').select('*').order('created_at', { ascending: false })
    setMerchProducts(data || [])
    setLoadingMerch(false)
  }

  function openMerchForm(product = null) {
    setMerchError(null); setMerchImages([])
    if (product) {
      setMerchForm({ name: product.name, description: product.description, price: (product.price_cents / 100).toFixed(2), category: product.category, stock_status: product.stock_status, is_active: product.is_active })
      setEditingMerchId(product.id)
    } else {
      setMerchForm({ name: '', description: '', price: '', category: '', stock_status: 'in_stock', is_active: false })
      setEditingMerchId(null)
    }
  }

  function closeMerchForm() { setMerchForm(null); setEditingMerchId(null); setMerchImages([]); setMerchError(null) }

  async function handleMerchImageSelect(e) {
    try {
      const processed = await processFiles(e.target.files)
      setMerchImages(prev => [...prev, ...processed])
    } catch (err) { setMerchError(err.message) }
    e.target.value = ''
  }

  function handleMerchDragEnter(e) { e.preventDefault(); setIsDragOverMerch(true) }
  function handleMerchDragOver(e) { e.preventDefault(); setIsDragOverMerch(true) }
  function handleMerchDragLeave(e) { if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragOverMerch(false) }
  async function handleMerchDrop(e) {
    e.preventDefault(); setIsDragOverMerch(false)
    try {
      const processed = await processFiles(e.dataTransfer.files)
      setMerchImages(prev => [...prev, ...processed])
    } catch (err) { setMerchError(err.message) }
  }

  function removeMerchImage(idx) { setMerchImages(prev => prev.filter((_, i) => i !== idx)) }

  async function saveMerchProduct() {
    if (!merchForm.name.trim()) { setMerchError('Product name is required.'); return }
    const priceCents = Math.round(parseFloat(merchForm.price || '0') * 100)
    if (isNaN(priceCents) || priceCents < 0) { setMerchError('Enter a valid price.'); return }
    setMerchSaving(true); setMerchError(null)
    try {
      let productId = editingMerchId
      const existingImageUrls = editingMerchId ? (merchProducts.find(p => p.id === editingMerchId)?.image_urls || []) : []
      if (!productId) {
        const { data, error } = await supabase.from('merch_products').insert({
          name: merchForm.name.trim(), description: merchForm.description.trim(), price_cents: priceCents,
          category: merchForm.category.trim(), stock_status: merchForm.stock_status,
          is_active: merchForm.is_active, image_urls: [],
        }).select().single()
        if (error) throw error
        productId = data.id
      }
      const newImageUrls = []
      for (let i = 0; i < merchImages.length; i++) {
        const blob = await fetch(merchImages[i].previewUrl).then(r => r.blob())
        const path = `merch/${productId}/${Date.now()}_${i}.jpg`
        const { error: uploadError } = await supabase.storage.from('hike-photos').upload(path, blob, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        newImageUrls.push(supabase.storage.from('hike-photos').getPublicUrl(path).data.publicUrl)
      }
      const { error: updateError } = await supabase.from('merch_products').update({
        name: merchForm.name.trim(), description: merchForm.description.trim(), price_cents: priceCents,
        category: merchForm.category.trim(), stock_status: merchForm.stock_status,
        is_active: merchForm.is_active, image_urls: [...existingImageUrls, ...newImageUrls],
      }).eq('id', productId)
      if (updateError) throw updateError
      await loadMerch()
      closeMerchForm()
    } catch (err) { setMerchError(err.message) }
    finally { setMerchSaving(false) }
  }

  async function toggleMerchActive(product) {
    await supabase.from('merch_products').update({ is_active: !product.is_active }).eq('id', product.id)
    setMerchProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_active: !p.is_active } : p))
  }

  async function deleteMerchProduct(id) {
    const { error } = await supabase.from('merch_products').delete().eq('id', id)
    if (error) { setMerchError(error.message); return }
    setMerchProducts(prev => prev.filter(p => p.id !== id))
    setMerchDeleteConfirm(null)
  }

  const activeProducts = merchProducts.filter(p => p.is_active)
  const archivedProducts = merchProducts.filter(p => !p.is_active)

  return (
    <main className="admin-main">
      <section className="admin-section">
        <label className="admin-label">PRODUCTS</label>
        {loadingMerch ? (
          <p className="admin-or">Loading…</p>
        ) : (
          <>
            {activeProducts.length === 0 && !merchForm && (
              <p className="admin-or">No active products yet.</p>
            )}
            <div className="admin-merch-list">
              {activeProducts.map(product => (
                <div key={product.id} className="admin-merch-product">
                  {merchDeleteConfirm === product.id ? (
                    <div className="admin-gear-delete-confirm">
                      <span>Delete "{product.name}"?</span>
                      <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => deleteMerchProduct(product.id)}>Yes, delete</button>
                      <button className="admin-gear-ctrl" onClick={() => setMerchDeleteConfirm(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="admin-merch-product-info">
                        {product.image_urls.length > 0 && (
                          <img src={product.image_urls[0]} alt={product.name} className="admin-merch-thumb" />
                        )}
                        <div className="admin-merch-product-details">
                          <span className="admin-merch-product-name">{product.name}</span>
                          <span className="admin-merch-product-meta">
                            {product.category && `${product.category} · `}
                            {formatPrice(product.price_cents)} ·{' '}
                            <span className={`admin-merch-badge admin-merch-badge-${product.stock_status}`}>
                              {product.stock_status === 'in_stock' ? 'In Stock' : product.stock_status === 'low_stock' ? 'Low Stock' : 'Out of Stock'}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="admin-gear-item-controls">
                        <button className="admin-gear-ctrl" onClick={() => openMerchForm(product)}>Edit</button>
                        <button className="admin-gear-ctrl" onClick={() => toggleMerchActive(product)}>Archive</button>
                        <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => setMerchDeleteConfirm(product.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {archivedProducts.length > 0 && (
              <div className="admin-merch-archived-section">
                <button className="admin-btn-ghost" onClick={() => setShowArchivedMerch(v => !v)}>
                  {showArchivedMerch ? 'Hide' : 'Show'} Archived ({archivedProducts.length})
                </button>
                {showArchivedMerch && (
                  <div className="admin-merch-list admin-merch-list-archived">
                    {archivedProducts.map(product => (
                      <div key={product.id} className="admin-merch-product admin-merch-product-archived">
                        <div className="admin-merch-product-info">
                          <div className="admin-merch-product-details">
                            <span className="admin-merch-product-name">{product.name}</span>
                            <span className="admin-merch-product-meta">{product.category && `${product.category} · `}{formatPrice(product.price_cents)}</span>
                          </div>
                        </div>
                        <div className="admin-gear-item-controls">
                          <button className="admin-gear-ctrl" onClick={() => toggleMerchActive(product)}>Restore</button>
                          <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => setMerchDeleteConfirm(product.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {merchForm && (
              <div className="admin-gear-form admin-gear-form-add">
                <label className="admin-label">{editingMerchId ? 'EDIT PRODUCT' : 'ADD PRODUCT'}</label>
                <div className="admin-gear-form-row">
                  <input className="admin-input" placeholder="Product name" value={merchForm.name} onChange={e => setMerchForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="admin-input" placeholder="Category (e.g. Apparel)" value={merchForm.category} onChange={e => setMerchForm(f => ({ ...f, category: e.target.value }))} />
                </div>
                <textarea className="admin-textarea" rows={3} placeholder="Description" value={merchForm.description} onChange={e => setMerchForm(f => ({ ...f, description: e.target.value }))} />
                <div className="admin-gear-form-row">
                  <input className="admin-input" type="number" step="0.01" min="0" placeholder="Price (e.g. 29.99)" value={merchForm.price} onChange={e => setMerchForm(f => ({ ...f, price: e.target.value }))} />
                  <select className="admin-input" value={merchForm.stock_status} onChange={e => setMerchForm(f => ({ ...f, stock_status: e.target.value }))}>
                    <option value="in_stock">In Stock</option>
                    <option value="low_stock">Low Stock</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </select>
                </div>
                <label className="admin-merch-active-label">
                  <input type="checkbox" checked={merchForm.is_active} onChange={e => setMerchForm(f => ({ ...f, is_active: e.target.checked }))} />
                  Active (visible on storefront when live)
                </label>

                <label className="admin-label" style={{ marginTop: '1.25rem' }}>PHOTOS <span className="admin-label-optional">optional</span></label>
                {editingMerchId && (merchProducts.find(p => p.id === editingMerchId)?.image_urls || []).length > 0 && (
                  <div className="admin-existing-strip">
                    <p className="admin-existing-label">Existing images</p>
                    <div className="admin-existing-thumbs">
                      {(merchProducts.find(p => p.id === editingMerchId)?.image_urls || []).map((url, i) => (
                        <img key={i} src={url} alt="" className="admin-existing-thumb" />
                      ))}
                    </div>
                  </div>
                )}
                <div
                  className={`admin-drop-zone${isDragOverMerch ? ' admin-drop-zone-active' : ''}${merchImages.length > 0 ? ' admin-drop-zone-has-photos' : ''}`}
                  onDragEnter={handleMerchDragEnter} onDragOver={handleMerchDragOver} onDragLeave={handleMerchDragLeave} onDrop={handleMerchDrop}
                  onClick={() => merchImageInputRef.current.click()}
                >
                  <input ref={merchImageInputRef} type="file" accept="image/*,.heic,.heif" multiple style={{ display: 'none' }} onChange={handleMerchImageSelect} />
                  {merchImages.length === 0 ? (
                    <><span className="admin-drop-icon">↑</span><p className="admin-drop-text">Drag images or <span className="admin-drop-link">click to browse</span></p></>
                  ) : (
                    <>
                      <div className="admin-photo-grid" onClick={e => e.stopPropagation()}>
                        {merchImages.map((img, i) => (
                          <div key={i} className="admin-photo-thumb">
                            <img src={img.previewUrl} alt="" />
                            <div className="admin-photo-controls">
                              <button className="admin-photo-ctrl admin-photo-ctrl-remove" onClick={e => { e.stopPropagation(); removeMerchImage(i) }}>×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="admin-drop-add-more">Drop more or <span className="admin-drop-link">click to browse</span></p>
                    </>
                  )}
                </div>

                {merchError && <p className="admin-error">{merchError}</p>}
                <div className="admin-gear-form-actions">
                  <button className="admin-btn-primary" onClick={saveMerchProduct} disabled={merchSaving}>{merchSaving ? 'Saving…' : editingMerchId ? 'Save Changes' : 'Add Product'}</button>
                  <button className="admin-btn-ghost" onClick={closeMerchForm}>Cancel</button>
                </div>
              </div>
            )}

            {!merchForm && (
              <button className="admin-btn-ghost admin-gear-add-btn" onClick={() => openMerchForm()}>+ Add Product</button>
            )}
          </>
        )}
      </section>
    </main>
  )
}
