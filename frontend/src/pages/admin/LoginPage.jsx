import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { admin } from '../../api'
import '../../styles/admin.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await admin.login(username.trim(), password)
      navigate('/admin/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        <div className="admin-login-logo">
          <img src="/newlogo.png" alt="WTL" onError={(e) => { e.target.src = '/newfavicon.png' }} />
        </div>
        <div className="admin-login-title">We The Leaders</div>
        <div className="admin-login-subtitle">Admin Panel — Lead the Change</div>

        <form onSubmit={handleSubmit}>
          <div className="admin-form-group">
            <label className="admin-form-label">Username</label>
            <input
              className="admin-form-control"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="admin-form-group">
            <label className="admin-form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="admin-form-control"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={loading}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer', fontSize: 16 }}
              >
                <i className={`bi bi-eye${showPass ? '-slash' : ''}`} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.2)', borderRadius: 7, padding: '9px 12px', fontSize: 13, color: '#ef9a9a', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
              <i className="bi bi-exclamation-circle" /> {error}
            </div>
          )}

          <button className="admin-login-btn" type="submit" disabled={loading}>
            {loading
              ? <><span className="spinner-border spinner-border-sm me-2" /> Signing in…</>
              : <><i className="bi bi-shield-lock me-2" />Sign In</>
            }
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#8696a0' }}>
          <i className="bi bi-lock" /> Secure admin access only
        </p>
      </div>
    </div>
  )
}
