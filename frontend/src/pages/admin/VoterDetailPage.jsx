import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { admin } from '../../api'
import { CardPreviewIframe } from '../../components/CardPreviewIframe'

export default function VoterDetailPage() {
  const { epicNo } = useParams()
  const navigate   = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    admin.getVoterDetail(epicNo)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load voter'))
      .finally(() => setLoading(false))
  }, [epicNo])

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner-border text-danger" /></div>
  if (error) return <div style={{ padding: 24, color: '#ef9a9a' }}><i className="bi bi-exclamation-circle me-2" />{error}</div>

  const v = data?.voter || data || {}
  const generations = data?.generations || []

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#8696a0', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
          <i className="bi bi-arrow-left" />
        </button>
        <div>
          <h1>Voter Detail</h1>
          <p>EPIC: {epicNo}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Profile card */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-header">
            <h6 className="admin-card-title"><i className="bi bi-person-badge" /> Voter Info</h6>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
              {v.photo_url ? (
                <img src={v.photo_url} alt="Voter" className="voter-photo-preview" />
              ) : (
                <div style={{ width: 70, height: 90, background: 'rgba(229,57,53,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-person" style={{ fontSize: 28, color: '#E53935' }} />
                </div>
              )}
              <div className="detail-grid" style={{ flex: 1 }}>
                {[
                  { label: 'Name',          value: v.name || v.Name },
                  { label: "Father's Name", value: v.father_name || v.FatherName },
                  { label: 'EPIC No',       value: v.epic_no || epicNo },
                  { label: 'Assembly',      value: v.assembly || v.AssemblyName },
                  { label: 'District',      value: v.district || v.DistrictName },
                  { label: 'Part No',       value: v.part_no },
                  { label: 'Age / Gender',  value: [v.age, v.gender].filter(Boolean).join(' / ') || undefined },
                ].filter((f) => f.value).map((f) => (
                  <div key={f.label} className="detail-field">
                    <span className="detail-label">{f.label}</span>
                    <span className="detail-value">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
            {v.card_url && (
              <div>
                <div className="detail-label" style={{ marginBottom: 6 }}>Generated Card</div>
                <CardPreviewIframe cardData={v} width={280} />
              </div>
            )}
          </div>
        </div>

        {/* Generation history */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-header">
            <h6 className="admin-card-title"><i className="bi bi-clock-history" /> Generation History ({generations.length})</h6>
          </div>
          {generations.length === 0 ? (
            <div className="empty-state"><i className="bi bi-credit-card" /><p>No cards generated yet.</p></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>Generated At</th><th>Mobile</th><th>WTL Code</th></tr></thead>
                <tbody>
                  {generations.map((g, i) => {
                    const codeVal = g.wtl_code || g.ptc_code
                    return (
                      <tr key={i}>
                        <td style={{ color: '#8696a0' }}>{i + 1}</td>
                        <td>{g.generated_at ? new Date(g.generated_at).toLocaleString() : '—'}</td>
                        <td style={{ color: '#8696a0' }}>{g.mobile || '—'}</td>
                        <td>
                          {codeVal
                            ? <Link to={`/admin/generated-voters/${codeVal}`} style={{ color: '#43a047', fontWeight: 600, fontSize: 12 }}>{codeVal}</Link>
                            : '—'
                          }
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
