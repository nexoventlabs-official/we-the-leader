import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { admin } from '../../api'
import { CardPreviewIframe } from '../../components/CardPreviewIframe'

export default function GeneratedVoterDetailPage() {
  const { ptcCode } = useParams()
  const navigate    = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    admin.getGeneratedVoterDetail(ptcCode)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load member'))
      .finally(() => setLoading(false))
  }, [ptcCode])

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner-border text-danger" /></div>
  if (error)   return <div style={{ padding: 24, color: '#ef9a9a' }}><i className="bi bi-exclamation-circle me-2" />{error}</div>

  const v = data?.voter || data?.member || data || {}
  const referred = data?.referred_members || data?.members || []
  const vol    = data?.volunteer_status
  const booth  = data?.booth_agent_status

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#8696a0', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
          <i className="bi bi-arrow-left" />
        </button>
        <div>
          <h1>Member Detail</h1>
          <p>PTC Code: {ptcCode}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Member info */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-header">
            <h6 className="admin-card-title"><i className="bi bi-person-badge" /> Member Info</h6>
            {v.epic_no && (
              <Link to={`/verify/${v.epic_no}`} target="_blank" className="btn-action btn-view" style={{ fontSize: 11 }}>
                <i className="bi bi-patch-check" /> Verify
              </Link>
            )}
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
              {v.photo_url ? (
                <img src={v.photo_url} alt="Photo" className="voter-photo-preview" />
              ) : (
                <div style={{ width: 70, height: 90, background: 'rgba(229,57,53,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className="bi bi-person" style={{ fontSize: 28, color: '#E53935' }} />
                </div>
              )}
              <div style={{ flex: 1 }}>
                {[
                  { label: 'Name',      value: v.name || v.Name },
                  { label: 'EPIC No',   value: v.epic_no || v.EpicNo },
                  { label: 'Mobile',    value: v.mobile },
                  { label: 'PTC Code',  value: v.ptc_code || ptcCode },
                  { label: 'Assembly',  value: v.assembly || v.AssemblyName },
                  { label: 'District',  value: v.district || v.DistrictName },
                  { label: 'Generated', value: v.generated_at ? new Date(v.generated_at).toLocaleString() : undefined },
                ].filter((f) => f.value).map((f) => (
                  <div key={f.label} className="detail-field" style={{ marginBottom: 8 }}>
                    <span className="detail-label">{f.label}</span>
                    <span className="detail-value" style={{ fontSize: 13 }}>{f.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Card preview */}
            {v.card_url && (
              <div>
                <div className="detail-label" style={{ marginBottom: 8 }}>Generated Card</div>
                <CardPreviewIframe cardData={v} width={280} />
              </div>
            )}

            {/* Volunteer / booth status */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {vol && (
                <span className={`badge-status badge-${vol}`}><i className="bi bi-hand-thumbs-up" /> Volunteer: {vol}</span>
              )}
              {booth && (
                <span className={`badge-status badge-${booth}`}><i className="bi bi-building" /> Booth Agent: {booth}</span>
              )}
            </div>
          </div>
        </div>

        {/* Referred members */}
        <div className="admin-card" style={{ margin: 0 }}>
          <div className="admin-card-header">
            <h6 className="admin-card-title"><i className="bi bi-people" /> Referred Members ({referred.length})</h6>
          </div>
          {referred.length === 0 ? (
            <div className="empty-state"><i className="bi bi-people" /><p>No referred members yet.</p></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>Name</th><th>EPIC</th><th>Generated At</th></tr></thead>
                <tbody>
                  {referred.map((r, i) => (
                    <tr key={i}>
                      <td style={{ color: '#8696a0' }}>{i + 1}</td>
                      <td>{r.name || r.Name}</td>
                      <td>
                        {r.epic_no
                          ? <Link to={`/admin/voters/${r.epic_no}`} style={{ color: '#64b5f6', fontSize: 11 }}>{r.epic_no}</Link>
                          : '—'
                        }
                      </td>
                      <td style={{ color: '#8696a0', fontSize: 11 }}>
                        {r.generated_at ? new Date(r.generated_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
