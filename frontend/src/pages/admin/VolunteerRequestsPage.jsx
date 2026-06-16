import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { admin } from '../../api'

function Pagination({ page, total, perPage = 20, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  if (totalPages <= 1) return null
  const start = Math.max(1, page - 2)
  const end   = Math.min(totalPages, page + 2)
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)
  return (
    <div className="admin-pagination">
      <span className="pagination-info">{total} records</span>
      <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}><i className="bi bi-chevron-left" /></button>
      {pages.map((p) => <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => onChange(p)}>{p}</button>)}
      <button className="page-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}><i className="bi bi-chevron-right" /></button>
    </div>
  )
}

export default function VolunteerRequestsPage() {
  const [data, setData]       = useState({ requests: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [actionLoading, setActionLoading] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.getVolunteerRequests({ page, status: statusFilter, per_page: 20 })
      setData({ requests: res.requests || res.data || [], total: res.total || 0 })
    } catch {
      setData({ requests: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const handleAction = async (ptcCode, action) => {
    if (!window.confirm(`Are you sure you want to ${action} this volunteer request?`)) return
    setActionLoading((prev) => ({ ...prev, [ptcCode]: action }))
    try {
      if (action === 'confirm') await admin.confirmVolunteer(ptcCode)
      else                      await admin.rejectVolunteer(ptcCode)
      loadData()
    } catch (err) {
      alert(err.message || `Failed to ${action} request`)
    } finally {
      setActionLoading((prev) => { const n = { ...prev }; delete n[ptcCode]; return n })
    }
  }

  const requests = data.requests

  return (
    <div>
      <div className="page-header">
        <h1><i className="bi bi-hand-thumbs-up-fill me-2 text-coral" />Volunteer Requests</h1>
        <p>Review and manage volunteer applications</p>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h6 className="admin-card-title"><i className="bi bi-table" /> Requests</h6>
          <div className="admin-card-tools">
            <select
              className="admin-select"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="rejected">Rejected</option>
              <option value="">All</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner-border spinner-border-sm text-danger" /></div>
        ) : requests.length === 0 ? (
          <div className="empty-state"><i className="bi bi-hand-thumbs-up" /><p>No {statusFilter} volunteer requests found.</p></div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>EPIC No</th>
                    <th>PTC Code</th>
                    <th>Mobile</th>
                    <th>Requested At</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r, i) => {
                    const status = r.status || 'pending'
                    const key = r.ptc_code || r.epic_no || i
                    const isLoading = actionLoading[r.ptc_code]
                    return (
                      <tr key={key}>
                        <td style={{ color: '#8696a0' }}>{(page - 1) * 20 + i + 1}</td>
                        <td>{r.name || r.Name}</td>
                        <td>
                          <Link to={`/admin/voters/${r.epic_no}`} style={{ color: '#64b5f6', fontSize: 12 }}>{r.epic_no}</Link>
                        </td>
                        <td>
                          {r.ptc_code
                            ? <Link to={`/admin/generated-voters/${r.ptc_code}`} style={{ color: '#43a047', fontSize: 12 }}>{r.ptc_code}</Link>
                            : '—'
                          }
                        </td>
                        <td style={{ color: '#8696a0', fontSize: 12 }}>{r.mobile || '—'}</td>
                        <td style={{ color: '#8696a0', fontSize: 11 }}>
                          {r.requested_at ? new Date(r.requested_at).toLocaleDateString() : '—'}
                        </td>
                        <td><span className={`badge-status badge-${status}`}>{status}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 5 }}>
                            {status === 'pending' && (
                              <>
                                <button
                                  className="btn-action btn-confirm"
                                  onClick={() => handleAction(r.ptc_code, 'confirm')}
                                  disabled={!!isLoading}
                                >
                                  {isLoading === 'confirm' ? <span className="spinner-border spinner-border-sm" /> : <><i className="bi bi-check-lg" /> Confirm</>}
                                </button>
                                <button
                                  className="btn-action btn-reject"
                                  onClick={() => handleAction(r.ptc_code, 'reject')}
                                  disabled={!!isLoading}
                                >
                                  {isLoading === 'reject' ? <span className="spinner-border spinner-border-sm" /> : <><i className="bi bi-x-lg" /> Reject</>}
                                </button>
                              </>
                            )}
                            {status !== 'pending' && (
                              <span style={{ fontSize: 11, color: '#8696a0', fontStyle: 'italic' }}>Reviewed</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}
