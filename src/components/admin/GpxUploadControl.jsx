import { useRef } from 'react'

// Choose-file button + upload button + status messages, shared by MapsTab
// (replacing/adding GPX for an already-published hike) and PendingTab
// (a not-yet-published hike's first GPX, as part of setup).
export default function GpxUploadControl({ existingUrl, file, onChooseFile, onUpload, uploading, saved, error }) {
  const inputRef = useRef()
  return (
    <>
      {existingUrl && (
        <div className="admin-flag admin-flag-info">A GPX file already exists for this hike — uploading will replace it.</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        style={{ display: 'none' }}
        onChange={e => { onChooseFile(e.target.files[0] || null); e.target.value = '' }}
      />
      <button className="admin-btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => inputRef.current.click()}>
        {file ? file.name : 'Choose GPX file…'}
      </button>
      {error && <p className="admin-error">{error}</p>}
      {saved && <p className="admin-success">GPX uploaded!</p>}
      <button className="admin-btn-primary" onClick={onUpload} disabled={uploading || !file} style={{ marginTop: '1rem' }}>
        {uploading ? 'Uploading…' : 'Upload GPX'}
      </button>
    </>
  )
}
