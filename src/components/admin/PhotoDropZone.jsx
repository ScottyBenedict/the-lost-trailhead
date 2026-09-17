import { useRef } from 'react'

// Drag-and-drop + click-to-browse photo picker with a preview grid, shared by
// LogTripTab (trip photos — supports duplicate badges and rotate controls)
// and MerchTab (product images — neither of those, just remove).
export default function PhotoDropZone({
  photos, onFilesSelected, onRemove, onRotate,
  isDragOver, onDragEnter, onDragOver, onDragLeave, onDrop,
  emptyText = 'Drag photos here', addMoreText = 'Drop more',
}) {
  const inputRef = useRef()
  return (
    <div
      className={`admin-drop-zone${isDragOver ? ' admin-drop-zone-active' : ''}${photos.length > 0 ? ' admin-drop-zone-has-photos' : ''}`}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      onClick={() => inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        style={{ display: 'none' }}
        onChange={e => { onFilesSelected(e.target.files); e.target.value = '' }}
      />
      {photos.length === 0 ? (
        <>
          <span className="admin-drop-icon">↑</span>
          <p className="admin-drop-text">{emptyText} or <span className="admin-drop-link">click to browse</span></p>
        </>
      ) : (
        <>
          <div className="admin-photo-grid" onClick={e => e.stopPropagation()}>
            {photos.map((p, i) => (
              <div key={i} className={`admin-photo-thumb${p.isDuplicate ? ' admin-photo-thumb-duplicate' : ''}`}>
                <img src={p.previewUrl} alt="" />
                {p.isDuplicate && <span className="admin-photo-duplicate-badge">Duplicate</span>}
                <div className="admin-photo-controls">
                  {onRotate && (
                    <>
                      <button className="admin-photo-ctrl" onClick={e => { e.stopPropagation(); onRotate(i, 'ccw') }} title="Rotate left">↺</button>
                      <button className="admin-photo-ctrl" onClick={e => { e.stopPropagation(); onRotate(i, 'cw') }} title="Rotate right">↻</button>
                    </>
                  )}
                  <button className="admin-photo-ctrl admin-photo-ctrl-remove" onClick={e => { e.stopPropagation(); onRemove(i) }} title="Remove">×</button>
                </div>
              </div>
            ))}
          </div>
          <p className="admin-drop-add-more">{addMoreText} or <span className="admin-drop-link">click to browse</span></p>
        </>
      )}
    </div>
  )
}
