import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { processFiles } from '../../lib/adminUtils'

export default function ProfileTab({ session }) {
  const [profileBio, setProfileBio] = useState('')
  const [profileBioSaved, setProfileBioSaved] = useState('')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null)
  const [profileAvatar, setProfileAvatar] = useState(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState(null)
  const avatarInputRef = useRef()

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase.from('profiles').select('bio_text, avatar_url').eq('id', session.user.id).maybeSingle()
      if (data) { setProfileBioSaved(data.bio_text || ''); setProfileBio(''); setProfileAvatarUrl(data.avatar_url || null) }
    }
    loadProfile()
  }, [session])

  async function handleAvatarSelect(e) {
    if (!e.target.files || e.target.files.length === 0) return
    try {
      const processed = await processFiles(e.target.files)
      if (processed[0]) setProfileAvatar(processed[0])
    } catch (err) { setProfileError(err.message) }
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

  return (
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
  )
}
