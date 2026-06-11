import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { hikes } from '../data/hikes'
import LogTripTab from '../components/admin/LogTripTab'
import PendingTab from '../components/admin/PendingTab'
import GearTab from '../components/admin/GearTab'
import ProfileTab from '../components/admin/ProfileTab'
import MerchTab from '../components/admin/MerchTab'
import MapsTab from '../components/admin/MapsTab'

export default function AdminPage() {
  const { session, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState('log')
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('adminDarkMode') === 'true')
  const [pendingHikeIds, setPendingHikeIds] = useState([])

  function toggleDarkMode() {
    setDarkMode(prev => {
      const next = !prev
      localStorage.setItem('adminDarkMode', next)
      return next
    })
  }

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
            {pendingHikeIds.length > 0 && <span className="admin-tab-badge">{pendingHikeIds.length}</span>}
          </button>
          <button className={`admin-tab${activeTab === 'gear' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('gear')}>Gear</button>
          <button className={`admin-tab${activeTab === 'profile' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('profile')}>Profile</button>
          <button className={`admin-tab${activeTab === 'merch' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('merch')}>Merch</button>
          <button className={`admin-tab${activeTab === 'gpx' ? ' admin-tab-active' : ''}`} onClick={() => setActiveTab('gpx')}>Maps</button>
        </nav>
      </header>

      {activeTab === 'log' && <LogTripTab session={session} pendingHikeIds={pendingHikeIds} />}
      {activeTab === 'pending' && <PendingTab session={session} />}
      {activeTab === 'gear' && <GearTab session={session} />}
      {activeTab === 'profile' && <ProfileTab session={session} />}
      {activeTab === 'merch' && <MerchTab session={session} />}
      {activeTab === 'gpx' && <MapsTab session={session} />}
    </div>
  )
}
