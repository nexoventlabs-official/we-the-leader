import { useState, useEffect } from 'react'
import { admin } from '../../api'

function StatCard({ icon, label, value, color, bg }) {
  return (
    <div className="stat-card" style={{ '--sc-color': color, '--sc-bg': bg }}>
      <div className="stat-card-icon">
        <i className={`bi bi-${icon}`} />
      </div>
      <div className="stat-card-value">{value ?? '—'}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  )
}

function StatusRow({ label, status, detail }) {
  const cls = status === 'ok' ? 'ok' : status === 'warning' ? 'warning' : 'error'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#d1d7db' }}>
        <span className={`status-dot ${cls}`} />
        {label}
      </div>
      {detail !== undefined && (
        <span style={{ fontSize: 12, color: '#8696a0' }}>{detail}</span>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats]       = useState(null)
  const [extStats, setExtStats] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.allSettled([admin.getStats(), admin.getExternalStats()])
      .then(([s, e]) => {
        if (s.status === 'fulfilled') setStats(s.value)
        if (e.status === 'fulfilled') setExtStats(e.value)
      })
      .finally(() => setLoading(false))
  }, [])

  const s = stats || {}
  const e = extStats || {}

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner-border text-danger" role="status" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1><i className="bi bi-grid-1x2-fill me-2 text-coral" />Dashboard</h1>
        <p>Overview of We The Leaders membership platform</p>
      </div>

      {/* Primary stats */}
      <div className="stat-cards-grid">
        <StatCard icon="people-fill"        label="Total Voters"       value={s.total_voters}       color="#E53935" bg="rgba(229,57,53,0.12)" />
        <StatCard icon="person-check-fill"  label="Users Generated"    value={s.users_generated}    color="#43a047" bg="rgba(46,125,50,0.12)" />
        <StatCard icon="credit-card-fill"   label="Total Generations"  value={s.total_generations}  color="#1565c0" bg="rgba(21,101,192,0.12)" />
        <StatCard icon="cloud-upload-fill"  label="Cards on Cloud"     value={s.cards_on_cloud}     color="#6a1b9a" bg="rgba(106,27,154,0.12)" />
        <StatCard icon="card-list"          label="Generated Voters"   value={s.generated_voters}   color="#00838f" bg="rgba(0,131,143,0.12)" />
        <StatCard icon="share-fill"         label="Total Referrals"    value={s.total_referrals}    color="#e65100" bg="rgba(230,81,0,0.12)" />
      </div>

      {/* Volunteer & Booth stats */}
      <div className="stat-cards-grid">
        <StatCard icon="hand-thumbs-up"        label="Pending Volunteers"    value={s.pending_volunteers}    color="#fbc02d" bg="rgba(251,192,45,0.1)" />
        <StatCard icon="check-circle-fill"     label="Confirmed Volunteers"  value={s.confirmed_volunteers}  color="#43a047" bg="rgba(46,125,50,0.1)" />
        <StatCard icon="building"              label="Pending Booth Agents"  value={s.pending_booth_agents}  color="#fbc02d" bg="rgba(251,192,45,0.1)" />
        <StatCard icon="shield-fill-check"     label="Confirmed Booth Agents" value={s.confirmed_booth_agents} color="#1565c0" bg="rgba(21,101,192,0.1)" />
      </div>

      {/* System status */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h6 className="admin-card-title"><i className="bi bi-activity" /> System Status</h6>
          <span style={{ fontSize: 11, color: '#8696a0' }}>Live indicators</span>
        </div>
        <StatusRow
          label="Database Connection"
          status={e.db_status === 'connected' ? 'ok' : 'error'}
          detail={e.db_status || (s.total_voters !== undefined ? 'connected' : 'unknown')}
        />
        <StatusRow
          label="Cloudinary Storage"
          status={e.cloudinary_status === 'ok' ? 'ok' : e.cloudinary_status ? 'warning' : 'ok'}
          detail={e.cloudinary_credits !== undefined ? `${e.cloudinary_credits} credits remaining` : (e.cloudinary_status || 'N/A')}
        />
        <StatusRow
          label="SMS Service"
          status={e.sms_balance !== undefined ? (e.sms_balance > 10 ? 'ok' : 'warning') : 'ok'}
          detail={e.sms_balance !== undefined ? `Balance: ${e.sms_balance}` : (e.sms_status || 'N/A')}
        />
        {e.last_generation && (
          <StatusRow label="Last Card Generation" status="ok" detail={new Date(e.last_generation).toLocaleString()} />
        )}
      </div>

      {/* Raw stats (if API returns extra data) */}
      {Object.keys(s).length === 0 && Object.keys(e).length === 0 && (
        <div className="empty-state">
          <i className="bi bi-bar-chart-line" />
          <p>No statistics available. The backend may be returning a different format.</p>
        </div>
      )}
    </div>
  )
}
