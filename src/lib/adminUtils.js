import exifr from 'exifr'
import heic2any from 'heic2any'
import { hikes } from '../data/hikes'
import { supabase } from './supabase'

export const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB

// Photos are stored at the size the site can actually show them, not at
// whatever the phone shot. Originals were going up untouched at ~4 MB each
// (the largest was 11 MB), so one hike page cost about 28 MB to load and a
// few hundred views used up a month of Supabase's CDN allowance — which is
// what took the site down on 2026-09-19.
//
// The lightbox is capped at 77vw/75vh with object-fit: contain. On a 5K
// desktop that still works out to about 2880 device pixels across a
// landscape photo, so that is the long edge — 2048 is visibly soft there.
// The gallery cell is about 350px in a three-column grid, so 800 covers it
// at 2x.
//
// WebP, not JPEG: at 2880 it weighs what a 2560 JPEG does (across
// public/photos, 52 MB against 63 MB) while being sharp at full size
// rather than slightly soft. Supported everywhere since 2020.
export const PHOTO_TYPE = 'image/webp'
export const PHOTO_MAX_EDGE = 2880
export const PHOTO_QUALITY = 0.82
export const THUMB_MAX_EDGE = 800
export const THUMB_QUALITY = 0.8

// The thumbnail lives beside its photo under a prefixed name, so no column
// and no migration: given a storage_path, its thumbnail is always here.
export function thumbPath(storagePath) {
  const cut = storagePath.lastIndexOf('/') + 1
  return storagePath.slice(0, cut) + 'thumb_' + storagePath.slice(cut)
}

// Hikes already published to hikes.js, by both their slug id and (if set)
// their separate Supabase id — anything else showing up in hike_reports/
// hike_photos is a "pending" hike still waiting on a page.
export function getKnownHikeIds() {
  return new Set([...hikes.map(h => h.id), ...hikes.filter(h => h.supabaseId).map(h => h.supabaseId)])
}

// Shared by MapsTab (an already-published hike replacing/adding its GPX)
// and PendingTab (a not-yet-published hike getting its first GPX as part of
// setup) — same upload-then-upsert sequence either way.
export async function uploadGpxFile(hikeId, file, userId) {
  const path = `${hikeId}.gpx`
  const { error: uploadError } = await supabase.storage.from('gpx-files').upload(path, file, { contentType: 'application/gpx+xml', upsert: true })
  if (uploadError) throw uploadError
  const gpx_url = supabase.storage.from('gpx-files').getPublicUrl(path).data.publicUrl
  const { error: upsertError } = await supabase.from('hike_gpx').upsert({
    hike_id: hikeId, gpx_url, uploaded_by: userId, uploaded_at: new Date().toISOString(),
  }, { onConflict: 'hike_id' })
  if (upsertError) throw upsertError
  return gpx_url
}

const STOP_WORDS = new Set(['and', 'the', 'a', 'an', 'of', 'at', 'in'])

export async function computeHash(file) {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-')
}

export function unslugify(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2)
}

// prefix matching only when the shorter word is at least 4 chars (avoids "si" matching "silver")
export function wordsMatch(inputSlug, candidateId) {
  const inputWords = inputSlug.split('-').filter(w => w.length > 1 && !STOP_WORDS.has(w))
  const candidateWords = candidateId.split('-').filter(w => w.length > 1 && !STOP_WORDS.has(w))
  if (inputWords.length === 0) return false
  return inputWords.every(w =>
    candidateWords.some(cw => {
      if (cw === w) return true
      const [shorter, longer] = cw.length <= w.length ? [cw, w] : [w, cw]
      return shorter.length >= 4 && longer.startsWith(shorter)
    })
  )
}

export async function rotateImage(file) {
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
  return encode(canvas, PHOTO_MAX_EDGE, PHOTO_QUALITY)
}

// A gallery-sized copy of an already-rotated photo.
export async function makeThumb(dataUrl) {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d').drawImage(img, 0, 0)
  return encode(canvas, THUMB_MAX_EDGE, THUMB_QUALITY)
}

// Scale the long edge down to `maxEdge` and encode as PHOTO_TYPE. The halving
// loop matters: drawImage jumping straight from 4000px to 800px samples
// only a fraction of the source pixels, which softens edges and aliases
// anything fine (scree, branches, water texture). Halving until the last
// step is under 2x reads every pixel on the way down.
function encode(canvas, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height))
  if (scale === 1) return canvas.toDataURL(PHOTO_TYPE, quality)
  const target = { w: Math.round(canvas.width * scale), h: Math.round(canvas.height * scale) }
  let src = canvas
  while (src.width > target.w * 2) {
    const step = document.createElement('canvas')
    step.width = Math.max(target.w, Math.round(src.width / 2))
    step.height = Math.max(target.h, Math.round(src.height / 2))
    const sctx = step.getContext('2d')
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(src, 0, 0, step.width, step.height)
    src = step
  }
  const out = document.createElement('canvas')
  out.width = target.w
  out.height = target.h
  const octx = out.getContext('2d')
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(src, 0, 0, target.w, target.h)
  return out.toDataURL(PHOTO_TYPE, quality)
}

// A duplicate has to be recognised by what the picture looks like, not by
// its bytes. Every upload is re-encoded (rotated, resized, now WebP), and
// the photos already on a hike may be a repo file, an older JPEG upload or
// a fresh WebP one — so the same photograph has a different SHA-256 in
// every one of those forms. This is a difference hash: shrink to 9x8 grey,
// then record whether each pixel is darker than the one to its right. The
// result survives re-encoding, resizing and mild colour shifts, and two
// hashes are compared by counting differing bits.
export async function perceptualHash(src) {
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      // Needed for getImageData on a Supabase URL; storage sends
      // access-control-allow-origin: *. A data: URL ignores it.
      if (!src.startsWith('data:')) i.crossOrigin = 'anonymous'
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = src
    })
    const canvas = document.createElement('canvas')
    canvas.width = 9
    canvas.height = 8
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, 9, 8)
    const d = ctx.getImageData(0, 0, 9, 8).data
    const grey = (i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    let bits = ''
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits += grey(y * 9 + x) < grey(y * 9 + x + 1) ? '1' : '0'
    }
    return bits
  } catch {
    // A photo that will not load or taints the canvas simply is not
    // compared, rather than blocking the upload.
    return null
  }
}

// Out of 64. Measured on the Bandera uploads that prompted this: the two
// that really were the same photograph came back at 9 bits, and the four
// genuinely different shots of the same hike at 24 to 28. 14 sits in the
// middle of that gap — enough headroom that a slightly different
// re-encode of a duplicate still trips it, still nowhere near a different
// photo of the same place.
export const DUPLICATE_BITS = 14

export function looksDuplicate(hash, existing) {
  if (!hash) return false
  return existing.some((other) => {
    if (!other || other.length !== hash.length) return false
    let diff = 0
    for (let i = 0; i < hash.length; i++) if (hash[i] !== other[i]) diff++
    return diff <= DUPLICATE_BITS
  })
}

// Throws if any file exceeds MAX_FILE_BYTES — callers should catch and surface err.message
export async function processFiles(files, existingHashes = new Set(), existingLooks = []) {
  const imageFiles = Array.from(files).filter(f =>
    f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
  )
  const oversized = imageFiles.filter(f => f.size > MAX_FILE_BYTES)
  if (oversized.length > 0) {
    throw new Error(`${oversized.map(f => f.name).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 20 MB limit.`)
  }
  return Promise.all(imageFiles.map(async file => {
    let workingFile = file
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
      workingFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), { type: 'image/jpeg' })
    }
    const hash = await computeHash(file)
    const url = await rotateImage(workingFile)
    const looks = await perceptualHash(url)
    return {
      file: workingFile,
      previewUrl: url,
      thumbUrl: await makeThumb(url),
      hash,
      looks,
      // Exact byte match catches the same file dropped twice in one session;
      // the visual match catches the same photograph already on the hike in
      // any other form.
      isDuplicate: existingHashes.has(hash) || looksDuplicate(looks, existingLooks),
    }
  }))
}
