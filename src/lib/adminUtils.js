import exifr from 'exifr'
import heic2any from 'heic2any'

export const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB

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
  return canvas.toDataURL('image/jpeg', 0.92)
}

// Throws if any file exceeds MAX_FILE_BYTES — callers should catch and surface err.message
export async function processFiles(files, existingHashes = new Set()) {
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
    return { file: workingFile, previewUrl: url, hash, isDuplicate: existingHashes.has(hash) }
  }))
}
