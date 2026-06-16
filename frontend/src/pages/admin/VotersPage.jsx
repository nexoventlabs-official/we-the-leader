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
      <button className="page-btn" disabled={page <= 1} onClick={() => onChange(1)}><i className="bi bi-chevron-double-left" /></button>
      <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}><i className="bi bi-chevron-left" /></button>
      {start > 1 && <span className="pagination-info">…</span>}
      {pages.map((p) => <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => onChange(p)}>{p}</button>)}
      {end < totalPages && <span className="pagination-info">…</span>}
      <button className="page-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}><i className="bi bi-chevron-right" /></button>
      <button className="page-btn" disabled={page >= totalPages} onClick={() => onChange(totalPages)}><i className="bi bi-chevron-double-right" /></button>
    </div>
  )
}

export default function VotersPage() {
  const [data, setData]     = useState({ voters: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.getVoters({ page, search, per_page: 20 })
      setData({ voters: res.voters || res.data || [], total: res.total || 0 })
    } catch {
      setData({ voters: [], total: 0 })
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

  const voters = data.voters

  return (
    <div>
      <div className="page-header">
        <h1><i className="bi bi-people-fill me-2 text-coral" />Voters</h1>
        <p>All registered voters in the electoral database</p>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <h6 className="admin-card-title"><i className="bi bi-table" /> Voter List</h6>
          <form className="admin-card-tools" onSubmit={handleSearch}>
            <input
              className="admin-search-input"
              type="text"
              placeholder="Search name / EPIC…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" style={{ background: 'var(--color-coral-pulse)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <i className="bi bi-search" /> Search
            </button>
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#8696a0', padding: '7px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </form>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner-border spinner-border-sm text-danger" /></div>
        ) : voters.length === 0 ? (
          <div className="empty-state"><i className="bi bi-people" /><p>No voters found{search ? ` for "${search}"` : ''}.</p></div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>EPIC No</th>
                    <th>Name</th>
                    <th>Assembly</th>
                    <th>District</th>
                    <th>Gen Count</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {voters.map((v, i) => (
                    <tr key={v.epic_no || v.EpicNo || i}>
                      <td style={{ color: '#8696a0' }}>{(page - 1) * 20 + i + 1}</td>
                      <td><code style={{ color: '#e9edef', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{v.epic_no || v.EpicNo}</code></td>
                      <td>{v.name || v.Name}</td>
                      <td style={{ color: '#8696a0' }}>{v.assembly || v.AssemblyName}</td>
                      <td style={{ color: '#8696a0' }}>{v.district || v.DistrictName}</td>
                      <td>
                        {(v.gen_count || v.generation_count || 0) > 0
                          ? <span className="badge-status badge-generated">{v.gen_count || v.generation_count}</span>
                          : <span style={{ color: '#8696a0', fontSize: 11 }}>0</span>
                        }
                      </td>
                      <td>
                        <Link to={`/admin/voters/${v.epic_no || v.EpicNo}`} className="btn-action btn-view">
                          <i className="bi bi-eye" /> View
                        </Link>
                      </td>
                    </tr>
                  ))}
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
