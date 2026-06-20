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

export default function ConfirmedBoothAgentsPage() {
  const [data, setData]       = useState({ agents: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [searchInput, setSearchInput] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.getConfirmedBoothAgents({ page, search, per_page: 20 })
      setData({ agents: res.agents || res.booth_agents || res.data || [], total: res.total || 0 })
    } catch {
      setData({ agents: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { loadData() }, [loadData])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const agents = data.agents

  return (
    <div>
      <div className="page-header">
        <h1><i className="bi bi-shield-fill-check me-2 text-coral" />Confirmed Booth Agents</h1>
        <p>All approved booth agents by assembly booth</p>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h6 className="admin-card-title">
            <i className="bi bi-shield-check" /> Booth Agents
            <span className="badge-status badge-confirmed ms-2" style={{ fontSize: 11 }}>{data.total}</span>
          </h6>
          <form className="admin-card-tools" onSubmit={handleSearch}>
            <input
              className="admin-search-input"
              type="text"
              placeholder="Search name / EPIC / booth…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" style={{ background: 'var(--color-coral-pulse)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>
              <i className="bi bi-search" />
            </button>
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#8696a0', padding: '7px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>Clear</button>
            )}
          </form>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner-border spinner-border-sm text-danger" /></div>
        ) : agents.length === 0 ? (
          <div className="empty-state"><i className="bi bi-shield-check" /><p>No confirmed booth agents found{search ? ` for "${search}"` : ''}.</p></div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>EPIC No</th>
                    <th>WTL Code</th>
                    <th>Booth No</th>
                    <th>Mobile</th>
                    <th>Assembly</th>
                    <th>Confirmed At</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => {
                    const codeVal = a.wtl_code || a.ptc_code
                    return (
                      <tr key={codeVal || a.epic_no || i}>
                        <td style={{ color: '#8696a0' }}>{(page - 1) * 20 + i + 1}</td>
                        <td>{a.name || a.Name}</td>
                        <td>
                          <Link to={`/admin/voters/${a.epic_no}`} style={{ color: '#64b5f6', fontSize: 12 }}>{a.epic_no}</Link>
                        </td>
                        <td>
                          {codeVal
                            ? <Link to={`/admin/generated-voters/${codeVal}`} style={{ color: '#43a047', fontSize: 12 }}>{codeVal}</Link>
                            : '—'
                          }
                        </td>
                        <td>
                          {a.booth_no
                            ? <span style={{ background: 'rgba(21,101,192,0.12)', color: '#64b5f6', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{a.booth_no}</span>
                            : '—'
                          }
                        </td>
                        <td style={{ color: '#8696a0', fontSize: 12 }}>{a.mobile || '—'}</td>
                        <td style={{ color: '#8696a0' }}>{a.assembly || a.AssemblyName || '—'}</td>
                        <td style={{ color: '#8696a0', fontSize: 11 }}>
                          {a.confirmed_at ? new Date(a.confirmed_at).toLocaleDateString() : '—'}
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
