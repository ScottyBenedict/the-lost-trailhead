import { useState, useEffect } from 'react'

// Native share sheet where the browser has one (phones, Safari, Chrome on
// macOS); otherwise copies the link. Dismissing the share sheet throws an
// AbortError, which is the user saying no — not a failure to fall back from.
export default function ShareButton({ title, text, url, children }) {
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2500)
    return () => clearTimeout(t)
  }, [message])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Link copied')
    } catch {
      setMessage("Couldn't copy link")
    }
  }

  async function handleClick() {
    const data = { title, text, url }
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data)
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    if (navigator.clipboard?.writeText) {
      await copyLink()
    } else {
      setMessage("Couldn't copy link")
    }
  }

  return (
    <div className="share-row">
      <button type="button" className="share-button" onClick={handleClick}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>
      {children}
      <span className="share-message" role="status" aria-live="polite">{message}</span>
    </div>
  )
}
