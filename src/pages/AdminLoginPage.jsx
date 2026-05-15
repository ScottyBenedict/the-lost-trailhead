import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export default function AdminLoginPage() {
  const { signIn, session, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isSettingPassword, setIsSettingPassword] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)

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

  async function handleForgotPassword(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/admin/login`,
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setResetSent(true)
      setLoading(false)
    }
  }

  if (isSettingPassword) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
          <h1 className="admin-login-title">The Lost Trailhead</h1>
          <p className="admin-login-sub">Set your password</p>
          <form onSubmit={handleSetPassword} className="admin-login-form">
            <div className="admin-input-wrap">
              <input
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Choose a password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="admin-input"
              />
              <button type="button" className="admin-input-toggle" onClick={() => setShowNewPassword(p => !p)}>
                {showNewPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {error && <p className="admin-error">{error}</p>}
            <button type="submit" className="admin-btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Set password & sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (isForgotPassword) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login-card">
          <h1 className="admin-login-title">The Lost Trailhead</h1>
          <p className="admin-login-sub">Reset your password</p>
          {resetSent ? (
            <p className="admin-success">Check your email for a reset link.</p>
          ) : (
            <form onSubmit={handleForgotPassword} className="admin-login-form">
              <input
                type="email"
                placeholder="Your email"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                required
                className="admin-input"
              />
              {error && <p className="admin-error">{error}</p>}
              <button type="submit" className="admin-btn-primary" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
          <button className="admin-btn-ghost admin-forgot-back" onClick={() => setIsForgotPassword(false)}>
            Back to sign in
          </button>
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
          <div className="admin-input-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="admin-input"
            />
            <button type="button" className="admin-input-toggle" onClick={() => setShowPassword(p => !p)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {error && <p className="admin-error">{error}</p>}
          <button type="submit" className="admin-btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <button className="admin-btn-ghost admin-forgot-link" onClick={() => setIsForgotPassword(true)}>
          Forgot password?
        </button>
      </div>
    </div>
  )
}
