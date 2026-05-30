import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { hikes } from '../data/hikes'
import exifr from 'exifr'
import heic2any from 'heic2any'
import TLTLogo from '../components/TLTLogo'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function computeHash(file) {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-')
}

function unslugify(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2)
}

const STOP_WORDS = new Set(['and', 'the', 'a', 'an', 'of', 'at', 'in'])

function wordsMatch(inputSlug, candidateId) {
  const inputWords = inputSlug.split('-').filter(w => w.length > 1 && !STOP_WORDS.has(w))
  const candidateWords = candidateId.split('-').filter(w => w.length > 1 && !STOP_WORDS.has(w))
  if (inputWords.length === 0) return false
  return inputWords.every(w => candidateWords.some(cw => cw.startsWith(w) || w.startsWith(cw)))
}

// ─── component ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { session, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState('log')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('adminDarkMode') === 'true')

  function toggleDarkMode() {
    setDarkMode(prev => {
      const next = !prev
      localStorage.setItem('adminDarkMode', next)
      return next
    })
  }

  // ── Log Trip ──────────────────────────────────────────────────────────────
  const [hikeId, setHikeId] = useState('')
  const [customHike, setCustomHike] = useState('')
  const [isNewHike, setIsNewHike] = useState(false)
  const [reportText, setReportText] = useState('')
  const [hotTake, setHotTake] = useState('')
  const [photos, setPhotos] = useState([])
  const [existingPhotos, setExistingPhotos] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingHikeIds, setPendingHikeIds] = useState([])
  const [existingHashes, setExistingHashes] = useState(new Set())
  const [hasExistingReport, setHasExistingReport] = useState(false)
  const [pendingMatch, setPendingMatch] = useState(null)
  const [knownMatch, setKnownMatch] = useState(null)
  const fileInputRef = useRef()

  // ── Pending tab ───────────────────────────────────────────────────────────
  const [pendingHikes, setPendingHikes] = useState([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [siteStats, setSiteStats] = useState(null)

  // ── Gear tab ──────────────────────────────────────────────────────────────
  const [gearItems, setGearItems] = useState([])
  const [loadingGear, setLoadingGear] = useState(false)
  const [gearForm, setGearForm] = useState(null)
  const [editingGearId, setEditingGearId] = useState(null)
  const [gearSaving, setGearSaving] = useState(false)
  const [gearError, setGearError] = useState(null)
  const [gearDeleteConfirm, setGearDeleteConfirm] = useState(null)

  // ── Profile tab ───────────────────────────────────────────────────────────
  const [profileBio, setProfileBio] = useState('')
  const [profileBioSaved, setProfileBioSaved] = useState('')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null)
  const [profileAvatar, setProfileAvatar] = useState(null)

  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState(null)
  const avatarInputRef = useRef()

  // ── Merch tab ─────────────────────────────────────────────────────────────
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

  // ── GPX tab ───────────────────────────────────────────────────────────────
  const [gpxHikeId, setGpxHikeId] = useState('')
  const [gpxFile, setGpxFile] = useState(null)
  const [gpxExistingUrl, setGpxExistingUrl] = useState(null)
  const [gpxSaving, setGpxSaving] = useState(false)
  const [gpxSaved, setGpxSaved] = useState(false)
  const [gpxError, setGpxError] = useState(null)
  const gpxFileInputRef = useRef()

  // ── Dates (within Maps tab) ───────────────────────────────────────────────
  const [dateHikeId, setDateHikeId] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [dateNotes, setDateNotes] = useState('')
  const [existingDates, setExistingDates] = useState([])
  const [dateSaving, setDateSaving] = useState(false)
  const [dateSaved, setDateSaved] = useState(false)
  const [dateError, setDateError] = useState(null)

  const selectedHikeId = hikeId || slugify(customHike)

  // ── effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedHikeId || isNewHike || !session) {
      setReportText(''); setHotTake(''); setExistingPhotos([]); setExistingHashes(new Set()); setHasExistingReport(false)
      return
    }
    async function loadHikeData() {
      const [reportRes, photosRes] = await Promise.all([
        supabase.from('hike_reports').select('report_text, hot_take').eq('hike_id', selectedHikeId).eq('user_id', session.user.id).maybeSingle(),
        supabase.from('hike_photos').select('storage_path, display_order, file_hash').eq('hike_id', selectedHikeId).order('display_order', { ascending: true }),
      ])
      if (reportRes.data && (reportRes.data.report_text || reportRes.data.hot_take)) {
        setReportText(reportRes.data.report_text || ''); setHotTake(reportRes.data.hot_take || ''); setHasExistingReport(true)
      } else {
        setReportText(''); setHotTake(''); setHasExistingReport(false)
      }
      if (photosRes.data && photosRes.data.length > 0) {
        const urls = photosRes.data.map(p => supabase.storage.from('hike-photos').getPublicUrl(p.storage_path).data.publicUrl)
        setExistingPhotos(urls)
        setExistingHashes(new Set(photosRes.data.filter(p => p.file_hash).map(p => p.file_hash)))
      } else {
        setExistingPhotos([]); setExistingHashes(new Set())
      }
    }
    loadHikeData()
  }, [selectedHikeId, isNewHike, session])

  useEffect(() => {
    if (!session) return
    async function fetchPendingIds() {
      const knownIds = new Set([...hikes.map(h => h.id), ...hikes.filter(h => h.supabaseId).map(h => h.supabaseId)])
      const [{ data: reportData }, { data: photoData }] = await Promise.all([
        supabase.from('hike_reports').select('hike_id'),
        supabase.from('hike_photos').select('hike_id'),
      ])
      const all = new Set([...(reportData || []).map(r => r.hike_id), ...(photoData || []).map(p => p.hike_id)])
      setPendingHikeIds([...all].filter(id => !knownIds.has(id)))
    }
    fetchPendingIds()
  }, [session])

  useEffect(() => {
    if (activeTab !== 'pending' || !session) return
    async function fetchPending() {
      setLoadingPending(true)
      const knownIds = new Set([...hikes.map(h => h.id), ...hikes.filter(h => h.supabaseId).map(h => h.supabaseId)])
      const [{ data: reportData }, { data: photoData }] = await Promise.all([
        supabase.from('hike_reports').select('hike_id, profiles(display_name)'),
        supabase.from('hike_photos').select('hike_id'),
      ])
      const byHike = {}
      for (const r of (reportData || [])) {
        if (knownIds.has(r.hike_id)) continue
        if (!byHike[r.hike_id]) byHike[r.hike_id] = { hike_id: r.hike_id, reports: 0, photos: 0, submitters: new Set() }
        byHike[r.hike_id].reports++
        if (r.profiles?.display_name) byHike[r.hike_id].submitters.add(r.profiles.display_name)
      }
      for (const p of (photoData || [])) {
        if (knownIds.has(p.hike_id)) continue
        if (!byHike[p.hike_id]) byHike[p.hike_id] = { hike_id: p.hike_id, reports: 0, photos: 0, submitters: new Set() }
        byHike[p.hike_id].photos++
      }
      setPendingHikes(Object.values(byHike).map(h => ({ ...h, submitters: [...h.submitters] })))
      const [{ count: hikeCount }, { count: photoCount }] = await Promise.all([
        supabase.from('hike_reports').select('*', { count: 'exact', head: true }),
        supabase.from('hike_photos').select('*', { count: 'exact', head: true }),
      ])
      setSiteStats({ hikes: hikeCount || 0, photos: photoCount || 0 })
      setLoadingPending(false)
    }
    fetchPending()
  }, [activeTab, session])

  useEffect(() => {
    if (activeTab !== 'gear' || !session) return
    loadGear()
  }, [activeTab, session])

  useEffect(() => {
    if (activeTab !== 'profile' || !session) return
    async function loadProfile() {
      const { data } = await supabase.from('profiles').select('bio_text, avatar_url').eq('id', session.user.id).maybeSingle()
      if (data) { setProfileBioSaved(data.bio_text || ''); setProfileBio(''); setProfileAvatarUrl(data.avatar_url || null) }
    }
    loadProfile()
  }, [activeTab, session])

  useEffect(() => {
    if (activeTab !== 'merch' || !session) return
    loadMerch()
  }, [activeTab, session])

  useEffect(() => {
    if (activeTab !== 'gpx' || !gpxHikeId || !session) { setGpxExistingUrl(null); return }
    supabase.from('hike_gpx').select('gpx_url').eq('hike_id', gpxHikeId).maybeSingle()
      .then(({ data }) => setGpxExistingUrl(data?.gpx_url || null))
  }, [activeTab, gpxHikeId, session])

  useEffect(() => {
    if (activeTab !== 'gpx' || !dateHikeId || !session) { setExistingDates([]); return }
    supabase.from('hike_dates').select('id, hike_date, notes').eq('hike_id', dateHikeId).order('hike_date', { ascending: false })
      .then(({ data }) => setExistingDates(data || []))
  }, [activeTab, dateHikeId, session])

  // ── shared image processing ───────────────────────────────────────────────

  async function rotateImage(file) {
    const orientation = await exifr.parse(file, ['Orientation']).then(d => d?.Orientation).catch(() => 1)
    const img = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    const needsSwap = orientation >= 5 && orientation <= 8
    canvas.width = needsSwap ? img.height : img.width
    canvas.height = needsSwap ? img.width : img.height
    const ctx = canvas.getContext('2d')
    const transforms = {
      1: [], 2: [{ scale: [-1, 1] }, { translate: [-img.width, 0] }],
      3: [{ rotate: Math.PI }, { translate: [-img.width, -img.height] }],
      4: [{ scale: [1, -1] }, { translate: [0, -img.height] }],
      5: [{ rotate: Math.PI / 2 }, { scale: [1, -1] }],
      6: [{ rotate: Math.PI / 2 }, { translate: [0, -img.height] }],
      7: [{ rotate: -Math.PI / 2 }, { scale: [-1, 1] }, { translate: [-img.width, -img.height] }],
      8: [{ rotate: -Math.PI / 2 }, { translate: [-img.width, 0] }],
    }
    const ops = transforms[orientation] || []
    for (const op of ops) {
      if (op.rotate !== undefined) ctx.rotate(op.rotate)
      if (op.scale) ctx.scale(...op.scale)
      if (op.translate) ctx.translate(...op.translate)
    }
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  async function processFiles(files) {
    const imageFiles = Array.from(files).filter(f =>
      f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
    )
    return Promise.all(imageFiles.map(async file => {
      let workingFile = file
      if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
        const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
        workingFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), { type: 'image/jpeg' })
      }
      const hash = await computeHash(file)
      const url = await rotateImage(workingFile)
      return { file: workingFile, previewUrl: url, hash, isDuplicate: existingHashes.has(hash) }
    }))
  }

  // ── Log Trip handlers ─────────────────────────────────────────────────────

  async function handlePhotoSelect(e) {
    const processed = await processFiles(e.target.files)
    setPhotos(prev => [...prev, ...processed])
    e.target.value = ''
  }

  function handleDragEnter(e) { e.preventDefault(); setIsDragOver(true) }
  function handleDragOver(e) { e.preventDefault(); setIsDragOver(true) }
  function handleDragLeave(e) { if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragOver(false) }
  async function handleDrop(e) {
    e.preventDefault(); setIsDragOver(false)
    const processed = await processFiles(e.dataTransfer.files)
    setPhotos(prev => [...prev, ...processed])
  }

  async function rotatePhoto(idx, direction) {
    const photo = photos[idx]
    const img = new Image()
    img.src = photo.previewUrl
    await new Promise(resolve => { img.onload = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = img.height; canvas.height = img.width
    const ctx = canvas.getContext('2d')
    if (direction === 'cw') { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2) }
    else { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2) }
    ctx.drawImage(img, 0, 0)
    setPhotos(prev => prev.map((p, i) => i === idx ? { ...p, previewUrl: canvas.toDataURL('image/jpeg', 0.92) } : p))
  }

  function removePhoto(idx) { setPhotos(prev => prev.filter((_, i) => i !== idx)) }

  function handleHikeSelect(e) {
    const val = e.target.value
    setHikeId(val); setCustomHike(''); setIsNewHike(false); setPendingMatch(null); setKnownMatch(null); setPhotos([])
  }

  function handleCustomHike(e) {
    const val = e.target.value
    setCustomHike(val); setHikeId(''); setPhotos([]); setPendingMatch(null); setKnownMatch(null)
    if (!val.length) { setIsNewHike(false); return }
    const slug = slugify(val)
    const exactKnown = hikes.find(h => h.id === slug || h.name.toLowerCase() === val.toLowerCase())
    if (exactKnown) { setKnownMatch(exactKnown); setIsNewHike(false); return }
    const wordKnownMatches = hikes.filter(h => wordsMatch(slug, h.id))
    if (wordKnownMatches.length === 1) { setKnownMatch(wordKnownMatches[0]); setIsNewHike(false); return }
    if (wordKnownMatches.length > 1) { setIsNewHike(false); return }
    const matched = pendingHikeIds.find(id => id === slug || wordsMatch(slug, id))
    if (matched) { setPendingMatch(matched); setIsNewHike(false); return }
    setIsNewHike(true)
  }

  async function handleSave() {
    if (!selectedHikeId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      if (reportText.trim() || hotTake.trim()) {
        const { error: reportError } = await supabase.from('hike_reports').upsert({
          hike_id: selectedHikeId, user_id: session.user.id, report_text: reportText,
          hot_take: hotTake, updated_at: new Date().toISOString(),
        }, { onConflict: 'hike_id,user_id' })
        if (reportError) throw reportError
      }
      for (let i = 0; i < photos.length; i++) {
        const blob = await fetch(photos[i].previewUrl).then(r => r.blob())
        const filename = `${Date.now()}_${i}.jpg`
        const storagePath = `${selectedHikeId}/${session.user.id}/${filename}`
        const { error: uploadError } = await supabase.storage.from('hike-photos').upload(storagePath, blob, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        await supabase.from('hike_photos').insert({
          hike_id: selectedHikeId, user_id: session.user.id, storage_path: storagePath,
          display_order: existingPhotos.length + i, file_hash: photos[i].hash,
        })
      }
      setHikeId(''); setCustomHike(''); setIsNewHike(false); setReportText(''); setHotTake('')
      setPhotos([]); setExistingPhotos([]); setExistingHashes(new Set()); setHasExistingReport(false)
      setSaved(true); setTimeout(() => setSaved(false), 4000)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  // ── Gear handlers ─────────────────────────────────────────────────────────

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
        }).eq('id', editingGearId)
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
    const { error } = await supabase.from('gear_items').delete().eq('id', id)
    if (!error) { setGearItems(prev => prev.filter(i => i.id !== id)); setGearDeleteConfirm(null) }
  }

  async function moveGearItem(id, direction) {
    const idx = gearItems.findIndex(i => i.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= gearItems.length) return
    const a = gearItems[idx]; const b = gearItems[swapIdx]
    await Promise.all([
      supabase.from('gear_items').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('gear_items').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    await loadGear()
  }

  // ── Profile handlers ──────────────────────────────────────────────────────

  async function handleAvatarSelect(e) {
    if (!e.target.files || e.target.files.length === 0) return
    const processed = await processFiles(e.target.files)
    if (processed[0]) setProfileAvatar(processed[0])
    e.target.value = ''
  }

  async function saveProfile() {
    setProfileSaving(true); setProfileError(null)
    try {
      let avatarUrl = profileAvatarUrl
      if (profileAvatar) {
        const blob = await fetch(profileAvatar.previewUrl).then(r => r.blob())
        const path = `${session.user.id}/avatar.jpg`
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (uploadError) throw uploadError
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`
      }
      const finalBio = profileBio.trim() ? profileBio : profileBioSaved
      const { error } = await supabase.from('profiles').update({ bio_text: finalBio, avatar_url: avatarUrl }).eq('id', session.user.id)
      if (error) throw error
      setProfileAvatarUrl(avatarUrl); setProfileAvatar(null)
      setProfileBioSaved(finalBio); setProfileBio('')
      setProfileSaved(true); setTimeout(() => setProfileSaved(false), 3000)
    } catch (err) { setProfileError(err.message) }
    finally { setProfileSaving(false) }
  }

  // ── GPX handlers ──────────────────────────────────────────────────────────

  async function handleGpxSave() {
    if (!gpxHikeId || !gpxFile) return
    setGpxSaving(true); setGpxError(null); setGpxSaved(false)
    try {
      const path = `${gpxHikeId}.gpx`
      const { error: uploadError } = await supabase.storage.from('gpx-files').upload(path, gpxFile, { contentType: 'application/gpx+xml', upsert: true })
      if (uploadError) throw uploadError
      const gpx_url = supabase.storage.from('gpx-files').getPublicUrl(path).data.publicUrl
      const { error: upsertError } = await supabase.from('hike_gpx').upsert({
        hike_id: gpxHikeId, gpx_url, uploaded_by: session.user.id, uploaded_at: new Date().toISOString(),
      }, { onConflict: 'hike_id' })
      if (upsertError) throw upsertError
      setGpxExistingUrl(gpx_url); setGpxFile(null)
      setGpxSaved(true); setTimeout(() => setGpxSaved(false), 4000)
    } catch (err) { setGpxError(err.message) }
    finally { setGpxSaving(false) }
  }

  // ── Date handlers ─────────────────────────────────────────────────────────

  async function handleDateSave() {
    if (!dateHikeId || !dateValue) return
    setDateSaving(true); setDateError(null); setDateSaved(false)
    try {
      const { data, error } = await supabase.from('hike_dates').insert({
        hike_id: dateHikeId, hike_date: dateValue, notes: dateNotes.trim() || null,
      }).select().single()
      if (error) throw error
      setExistingDates(prev => [data, ...prev].sort((a, b) => b.hike_date.localeCompare(a.hike_date)))
      setDateValue(''); setDateNotes('')
      setDateSaved(true); setTimeout(() => setDateSaved(false), 3000)
    } catch (err) { setDateError(err.message) }
    finally { setDateSaving(false) }
  }

  async function handleDateDelete(id) {
    const { error } = await supabase.from('hike_dates').delete().eq('id', id)
    if (!error) setExistingDates(prev => prev.filter(d => d.id !== id))
  }

  // ── Merch handlers ────────────────────────────────────────────────────────

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
    const processed = await processFiles(e.target.files)
    setMerchImages(prev => [...prev, ...processed])
    e.target.value = ''
  }

  function handleMerchDragEnter(e) { e.preventDefault(); setIsDragOverMerch(true) }
  function handleMerchDragOver(e) { e.preventDefault(); setIsDragOverMerch(true) }
  function handleMerchDragLeave(e) { if (e.currentTarget.contains(e.relatedTarget)) return; setIsDragOverMerch(false) }
  async function handleMerchDrop(e) {
    e.preventDefault(); setIsDragOverMerch(false)
    const processed = await processFiles(e.dataTransfer.files)
    setMerchImages(prev => [...prev, ...processed])
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
    await supabase.from('merch_products').delete().eq('id', id)
    setMerchProducts(prev => prev.filter(p => p.id !== id))
    setMerchDeleteConfirm(null)
  }

  // ── render ────────────────────────────────────────────────────────────────

  const activeProducts = merchProducts.filter(p => p.is_active)
  const archivedProducts = merchProducts.filter(p => !p.is_active)

  return (
    <div className={`admin-wrap${darkMode ? ' admin-dark' : ''}`}>
      <header className="admin-header">
        <div className="admin-header-top">
          <span className="admin-header-title">The Lost Trailhead <span className="admin-header-subtitle">Admin</span></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="admin-dark-toggle" onClick={toggleDarkMode} aria-label="Toggle dark mode">
              {darkMode ? '☀︎' : '☽'}
            </button>
            <button className="admin-btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <nav className="admin-tabs">
          <button className={`admin-tab${activeTab === 'log' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('log')}>Log Trip</button>
          <button className={`admin-tab${activeTab === 'pending' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('pending')}>
            Needs a Page
            {pendingHikes.length > 0 && <span className="admin-tab-badge">{pendingHikes.length}</span>}
          </button>
          <button className={`admin-tab${activeTab === 'gear' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('gear')}>Gear</button>
          <button className={`admin-tab${activeTab === 'profile' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('profile')}>Profile</button>
          <button className={`admin-tab${activeTab === 'merch' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('merch')}>Merch</button>
          <button className={`admin-tab${activeTab === 'gpx' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('gpx')}>Maps</button>
        </nav>
      </header>

      {/* ── Pending tab ───────────────────────────────────────────────── */}
      {activeTab === 'pending' && (
        <main className="admin-main">
          {loadingPending ? <p className="admin-or">Loading…</p> : pendingHikes.length === 0 ? (
            <div className="admin-pending-empty">
              <TLTLogo size={240} color="#c4c0b8" />
              <p className="admin-pending-empty-title">You're done here.</p>
              <p className="admin-pending-empty-sub">Every hike has a page. Don't worry — Alan is definitely already planning something you'll regret saying yes to.</p>
            </div>
          ) : (
            <div className="admin-pending-list">
              {pendingHikes.map(h => (
                <div key={h.hike_id} className="admin-pending-item">
                  <p className="admin-pending-name">{unslugify(h.hike_id)}</p>
                  <p className="admin-pending-meta">
                    {h.photos} photo{h.photos !== 1 ? 's' : ''}
                    {h.reports > 0 && ` · ${h.reports} report${h.reports !== 1 ? 's' : ''}`}
                    {h.submitters.length > 0 && ` · ${h.submitters.join(', ')}`}
                  </p>
                  <p className="admin-pending-slug">{h.hike_id}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* ── Log Trip tab ──────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <main className="admin-main">
          <section className="admin-section">
            <label className="admin-label">NEW HIKE</label>
            <input className="admin-input" type="text" placeholder="New hike name…" value={customHike} onChange={handleCustomHike} />
            {knownMatch && <div className="admin-flag admin-flag-block">This hike exists as "{knownMatch.name}" — select it from the dropdown below.</div>}
            {pendingMatch && <div className="admin-flag admin-flag-block">Already logged as "{unslugify(pendingMatch)}" — select it from the dropdown below to add more photos.</div>}
            {isNewHike && <div className="admin-flag">⚠️ This hike doesn't have a page yet — flagged for development.</div>}
            <p className="admin-or">or add photos and reports to a previous hike</p>
            <select className="admin-input" value={hikeId} onChange={handleHikeSelect}>
              <option value="">— choose a hike —</option>
              <optgroup label="Published hikes">
                {hikes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </optgroup>
              {pendingHikeIds.length > 0 && (
                <optgroup label="Needs a page">
                  {pendingHikeIds.map(id => <option key={id} value={id}>{unslugify(id)}</option>)}
                </optgroup>
              )}
            </select>
          </section>

          <section className="admin-section">
            <label className="admin-label">PHOTOS</label>
            {existingPhotos.length > 0 && (
              <div className="admin-existing-strip">
                <p className="admin-existing-label">{existingPhotos.length} photo{existingPhotos.length !== 1 ? 's' : ''} already on this hike</p>
                <div className="admin-existing-thumbs">
                  {existingPhotos.map((url, i) => <img key={i} src={url} alt="" className="admin-existing-thumb" onClick={() => setLightboxIndex(i)} />)}
                </div>
              </div>
            )}
            {lightboxIndex !== null && (
              <div className="admin-lightbox" onClick={() => setLightboxIndex(null)}>
                <img src={existingPhotos[lightboxIndex]} alt="" className="admin-lightbox-img" onClick={e => e.stopPropagation()} />
                {existingPhotos.length > 1 && (
                  <>
                    <button className="admin-lightbox-arrow admin-lightbox-prev" onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + existingPhotos.length) % existingPhotos.length) }}>‹</button>
                    <button className="admin-lightbox-arrow admin-lightbox-next" onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % existingPhotos.length) }}>›</button>
                  </>
                )}
                <span className="admin-lightbox-count">{lightboxIndex + 1} / {existingPhotos.length}</span>
              </div>
            )}
            <div
              className={`admin-drop-zone${isDragOver ? ' admin-drop-zone-active' : ''}${photos.length > 0 ? ' admin-drop-zone-has-photos' : ''}`}
              onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple style={{ display: 'none' }} onChange={handlePhotoSelect} />
              {photos.length === 0 ? (
                <><span className="admin-drop-icon">↑</span><p className="admin-drop-text">Drag photos here or <span className="admin-drop-link">click to browse</span></p></>
              ) : (
                <>
                  <div className="admin-photo-grid" onClick={e => e.stopPropagation()}>
                    {photos.map((p, i) => (
                      <div key={i} className={`admin-photo-thumb${p.isDuplicate ? ' admin-photo-thumb-duplicate' : ''}`}>
                        <img src={p.previewUrl} alt="" />
                        {p.isDuplicate && <span className="admin-photo-duplicate-badge">Duplicate</span>}
                        <div className="admin-photo-controls">
                          <button className="admin-photo-ctrl" onClick={e => { e.stopPropagation(); rotatePhoto(i, 'ccw') }} title="Rotate left">↺</button>
                          <button className="admin-photo-ctrl" onClick={e => { e.stopPropagation(); rotatePhoto(i, 'cw') }} title="Rotate right">↻</button>
                          <button className="admin-photo-ctrl admin-photo-ctrl-remove" onClick={e => { e.stopPropagation(); removePhoto(i) }} title="Remove">×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="admin-drop-add-more">Drop more or <span className="admin-drop-link">click to browse</span></p>
                </>
              )}
            </div>
          </section>

          <section className="admin-section">
            <label className="admin-label">TRIP REPORT <span className="admin-label-optional">optional</span></label>
            {hasExistingReport && <div className="admin-flag admin-flag-info">You've already submitted a report for this hike — saving will overwrite it.</div>}
            <textarea className="admin-textarea" rows={6} maxLength={350} placeholder="Write your trip report…" value={reportText} onChange={e => setReportText(e.target.value)} />
            <p className={`admin-char-count${reportText.length >= 330 ? ' admin-char-count-warn' : ''}`}>{reportText.length} / 350</p>
          </section>

          <section className="admin-section">
            <label className="admin-label">HOT TAKE <span className="admin-label-optional">optional</span></label>
            <input className="admin-input" type="text" placeholder="e.g. First Subaru to the trailhead, 15 there when we left!" value={hotTake} onChange={e => setHotTake(e.target.value)} />
          </section>

          {error && <p className="admin-error">{error}</p>}
          {saved && <p className="admin-success">Saved!</p>}
          <button className="admin-btn-primary" onClick={handleSave} disabled={saving || !selectedHikeId || !!pendingMatch || !!knownMatch}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </main>
      )}

      {/* ── Gear tab ──────────────────────────────────────────────────── */}
      {activeTab === 'gear' && (
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
                              {['Footwear','Shell','Pack','Watch','Phone/Camera','Poles','Gaiters','Gloves','Headlamp','Sunglasses','Baselayer','Midlayer','Pants','Tent','Stove','Sleeping Bag','Pad','Navigation','Accessories'].map(c => <option key={c} value={c}>{c}</option>)}
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
                        {['Footwear','Shell','Pack','Watch','Phone/Camera','Poles','Gaiters','Gloves','Headlamp','Sunglasses','Baselayer','Midlayer','Pants','Tent','Stove','Sleeping Bag','Pad','Navigation','Accessories'].map(c => <option key={c} value={c}>{c}</option>)}
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
      )}

      {/* ── Profile tab ───────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <main className="admin-main admin-main-profile">
          <section className="admin-section">
            <label className="admin-label">CURRENT AVATAR</label>
            <input ref={avatarInputRef} type="file" accept="image/*,.heic,.heif" style={{ display: 'none' }} onChange={handleAvatarSelect} />
            {(profileAvatarUrl || profileAvatar) ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div className="admin-avatar-change-wrap">
                  <img src={profileAvatar ? profileAvatar.previewUrl : profileAvatarUrl} alt="Avatar" className="admin-profile-avatar-img" />
                  <button className="admin-avatar-badge" onClick={() => avatarInputRef.current.click()} aria-label="Change avatar">+</button>
                </div>
                {profileAvatar && <button className="admin-btn-ghost" onClick={() => setProfileAvatar(null)}>Remove new photo</button>}
              </div>
            ) : (
              <div className="admin-avatar-empty" onClick={() => avatarInputRef.current.click()}>
                <span className="admin-avatar-empty-icon">+</span>
                <span className="admin-avatar-empty-label">Add photo</span>
              </div>
            )}
          </section>

          <section className="admin-section">
            <label className="admin-label">BIO</label>
            <p className="admin-or">Leave the right side blank to keep your current bio. Separate paragraphs with a blank line.</p>
            <div className="admin-bio-columns">
              <div className="admin-bio-pane">
                <p className="admin-bio-pane-label">CURRENT BIO</p>
                <div className="admin-bio-current-box">
                  {profileBioSaved
                    ? profileBioSaved.split('\n\n').map((para, i) => <p key={i} className="admin-bio-pane-text">{para}</p>)
                    : <p className="admin-bio-pane-empty">No bio saved yet.</p>
                  }
                </div>
              </div>
              <div className="admin-bio-pane">
                <p className="admin-bio-pane-label">NEW BIO</p>
                <textarea
                  className="admin-textarea admin-bio-textarea"
                  placeholder="Write replacement bio…"
                  value={profileBio}
                  onChange={e => setProfileBio(e.target.value)}
                />
              </div>
            </div>
          </section>

          {profileError && <p className="admin-error">{profileError}</p>}
          {profileSaved && <p className="admin-success">Profile saved!</p>}
          <button className="admin-btn-primary" onClick={saveProfile} disabled={profileSaving}>
            {profileSaving ? 'Saving…' : 'Save Profile'}
          </button>
        </main>
      )}

      {/* ── Merch tab ─────────────────────────────────────────────────── */}
      {activeTab === 'merch' && (
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
      )}

      {/* ── Maps / GPX tab ────────────────────────────────────────────── */}
      {activeTab === 'gpx' && (
        <main className="admin-main">
          <section className="admin-section">
            <label className="admin-label">UPLOAD GPX ROUTE</label>
            <p className="admin-or">Select a hike, then upload its GPX file. This powers the interactive trail map on the hike page.</p>
            <select className="admin-input" value={gpxHikeId} onChange={e => { setGpxHikeId(e.target.value); setGpxFile(null); setGpxError(null); setGpxSaved(false); setGpxExistingUrl(null) }}>
              <option value="">— choose a hike —</option>
              {hikes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>

            {gpxHikeId && (
              <>
                {gpxExistingUrl && (
                  <div className="admin-flag admin-flag-info">
                    A GPX file already exists for this hike — uploading will replace it.
                  </div>
                )}
                <input
                  ref={gpxFileInputRef}
                  type="file"
                  accept=".gpx,application/gpx+xml"
                  style={{ display: 'none' }}
                  onChange={e => { setGpxFile(e.target.files[0] || null); e.target.value = '' }}
                />
                <button className="admin-btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => gpxFileInputRef.current.click()}>
                  {gpxFile ? gpxFile.name : 'Choose GPX file…'}
                </button>
              </>
            )}

            {gpxError && <p className="admin-error">{gpxError}</p>}
            {gpxSaved && <p className="admin-success">GPX uploaded!</p>}
            {gpxHikeId && (
              <button className="admin-btn-primary" onClick={handleGpxSave} disabled={gpxSaving || !gpxFile} style={{ marginTop: '1rem' }}>
                {gpxSaving ? 'Uploading…' : 'Upload GPX'}
              </button>
            )}
          </section>

          <section className="admin-section">
            <label className="admin-label">HIKE DATES</label>
            <p className="admin-or">Log visit dates per hike. These drive the Recent sort order on the homepage.</p>
            <select className="admin-input" value={dateHikeId} onChange={e => { setDateHikeId(e.target.value); setDateValue(''); setDateNotes(''); setDateError(null); setDateSaved(false) }}>
              <option value="">— choose a hike —</option>
              {hikes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>

            {dateHikeId && (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: '0 0 auto' }}>
                    <p className="admin-or" style={{ margin: '0 0 4px' }}>Date hiked</p>
                    <input
                      className="admin-input"
                      type="date"
                      value={dateValue}
                      onChange={e => setDateValue(e.target.value)}
                      style={{ width: 'auto' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p className="admin-or" style={{ margin: '0 0 4px' }}>Notes <span className="admin-label-optional">optional</span></p>
                    <input
                      className="admin-input"
                      type="text"
                      placeholder="e.g. First snow of the season"
                      value={dateNotes}
                      onChange={e => setDateNotes(e.target.value)}
                    />
                  </div>
                </div>
                {dateError && <p className="admin-error">{dateError}</p>}
                {dateSaved && <p className="admin-success">Date saved!</p>}
                <button className="admin-btn-primary" onClick={handleDateSave} disabled={dateSaving || !dateValue} style={{ marginTop: '0.75rem' }}>
                  {dateSaving ? 'Saving…' : 'Add Date'}
                </button>

                {existingDates.length > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <p className="admin-or" style={{ marginBottom: '0.5rem' }}>Logged dates for this hike</p>
                    <div className="admin-gear-list">
                      {existingDates.map(d => (
                        <div key={d.id} className="admin-gear-item">
                          <div className="admin-gear-item-info">
                            <span className="admin-gear-item-name">{d.hike_date}</span>
                            {d.notes && <span className="admin-gear-item-category">{d.notes}</span>}
                          </div>
                          <div className="admin-gear-item-controls">
                            <button className="admin-gear-ctrl admin-gear-ctrl-danger" onClick={() => handleDateDelete(d.id)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </main>
      )}
    </div>
  )
}
