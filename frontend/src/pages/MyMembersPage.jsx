import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { chat } from '../api'

export default function MyMembersPage() {
  const { wtlCode } = useParams()
  const navigate = useNavigate()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!wtlCode) return
    chat.getMyMembers(wtlCode)
      .then((data) => {
        setMembers(data.members || [])
      })
      .catch((err) => {
        setError(err.message || 'Unable to load referred members.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [wtlCode])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-abyss)' }}>
        <div style={{ width: 40, height: 40, border: '3px solid rgba(12, 59, 28, 0.15)', borderTopColor: 'var(--color-signal-mint)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--color-abyss)', color: 'var(--color-chalk)', padding: 24, textAlign: 'center', letterSpacing: '0.05em' }}>
        <i className="bi bi-people-fill" style={{ fontSize: 48, color: 'var(--color-signal-mint)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Unable to Load Members</h2>
        <p style={{ color: 'var(--color-ash)', fontSize: 14 }}>{error}</p>
        <button onClick={() => navigate('/')} style={{ background: 'var(--color-signal-mint)', color: 'var(--color-abyss)', border: 'none', padding: '12px 24px', borderRadius: '16px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-abyss)', padding: '40px 16px', letterSpacing: '0.05em' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <img src="/newfavicon.png" alt="WTL" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--color-graphite)' }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-chalk)', letterSpacing: '0.1em' }}>WE THE LEADERS</div>
            <div style={{ fontSize: 11, color: 'var(--color-signal-mint)', fontWeight: 600 }}>My Referred Members ({members.length})</div>
          </div>
          <button
            onClick={() => navigate('/')}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--color-graphite)', color: 'var(--color-chalk)', padding: '8px 16px', borderRadius: '16px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.target.style.borderColor = 'var(--color-ash)' }}
            onMouseLeave={(e) => { e.target.style.borderColor = 'var(--color-graphite)' }}
          >
            <i className="bi bi-arrow-left" /> Back to Console
          </button>
        </div>

        {/* Content Box */}
        <div style={{ background: 'var(--color-carbon)', border: '1px solid var(--color-graphite)', borderRadius: 12, padding: 20, overflow: 'hidden' }}>
          
          {members.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-ash)' }}>
              <i className="bi bi-people" style={{ fontSize: 48, color: 'var(--color-graphite)', marginBottom: 16, display: 'block' }} />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-chalk)', marginBottom: 8 }}>No members registered yet</h3>
              <p style={{ fontSize: 13, maxWidth: 360, margin: '0 auto' }}>
                Share your referral link from the chat console to invite others and build your team.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-graphite)' }}>
                    <th style={{ padding: '12px 8px', color: 'var(--color-ash)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>#</th>
                    <th style={{ padding: '12px 8px', color: 'var(--color-ash)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Name</th>
                    <th style={{ padding: '12px 8px', color: 'var(--color-ash)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>EPIC No</th>
                    <th style={{ padding: '12px 8px', color: 'var(--color-ash)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>WTL Code</th>
                    <th style={{ padding: '12px 8px', color: 'var(--color-ash)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Joined Date</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => {
                    const nameVal = m.name || m.VOTER_NAME || `${m.FM_NAME_EN || ''} ${m.LASTNAME_EN || ''}`.trim() || 'A Member'
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)', transition: 'background 0.15s' }}>
                        <td style={{ padding: '14px 8px', color: 'var(--color-ash)' }}>{i + 1}</td>
                        <td style={{ padding: '14px 8px', fontWeight: 500, color: 'var(--color-chalk)' }}>{nameVal}</td>
                        <td style={{ padding: '14px 8px', color: 'var(--color-chalk)', fontFamily: 'monospace' }}>{m.epic_no || m.EPIC_NO || '—'}</td>
                        <td style={{ padding: '14px 8px', color: 'var(--color-signal-mint)', fontWeight: 600, fontFamily: 'monospace' }}>{m.wtl_code || '—'}</td>
                        <td style={{ padding: '14px 8px', color: 'var(--color-ash)', fontSize: 12 }}>
                          {m.generated_at ? new Date(m.generated_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
