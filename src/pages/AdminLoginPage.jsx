import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export default function AdminLoginPage() {
  const { signIn, session, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isSettingPassword, setIsSettingPassword] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
      setIsSettingPassword(true)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && session) {
      navigate('/admin')
    }
  }, [session, authLoading, navigate])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate('/admin')
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate('/admin')
    }
  }

  if (isSettingPassword) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
          <h1 className="admin-login-title">The Lost Trailhead</h1>
          <p className="admin-login-sub">Set your password</p>
          <form onSubmit={handleSetPassword} className="admin-login-form">
            <input
              type="password"
              placeholder="Choose a password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="admin-input"
            />
            {error && <p className="admin-error">{error}</p>}
            <button type="submit" className="admin-btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Set password & sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        <h1 className="admin-login-title">The Lost Trailhead</h1>
        <p className="admin-login-sub">Trail log admin</p>
        <form onSubmit={handleLogin} className="admin-login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="admin-input"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="admin-input"
          />
          {error && <p className="admin-error">{error}</p>}
          <button type="submit" className="admin-btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
