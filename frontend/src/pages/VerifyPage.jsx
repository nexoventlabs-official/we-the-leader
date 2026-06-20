import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi } from '../api'
import { CardPreviewIframe } from '../components/CardPreviewIframe'

export default function VerifyPage() {
  const { epicNo } = useParams()
  const navigate = useNavigate()
  const [voter, setVoter]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!epicNo) return
    publicApi.verifyVoter(epicNo)
      .then((data) => setVoter(data))
      .catch((err) => setError(err.message || 'Voter not found'))
      .finally(() => setLoading(false))
  }, [epicNo])

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner-border text-danger" role="status" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--color-abyss)', color: 'var(--color-chalk)', padding: 24, textAlign: 'center', letterSpacing: '0.05em' }}>
        <i className="bi bi-person-x" style={{ fontSize: 48, color: 'var(--color-signal-mint)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Voter Not Found</h2>
        <p style={{ color: 'var(--color-ash)', fontSize: 14 }}>{error}</p>
        <button onClick={() => navigate('/')} style={{ background: 'var(--color-signal-mint)', color: 'var(--color-abyss)', border: 'none', padding: '12px 24px', borderRadius: '16px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Go Back
        </button>
      </div>
    )
  }

  const v = voter?.voter || voter || {}
  const hasCard = !!(v.card_url || voter?.card_url)
  const isVolunteer = voter?.is_volunteer || v.is_volunteer
  const isBoothAgent = voter?.is_booth_agent || v.is_booth_agent
  const photoUrl = v.photo_url || voter?.photo_url

  const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 3 }
  const labelStyle = { fontSize: 10, color: 'var(--color-ash)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }
  const valueStyle = { fontSize: 14, color: 'var(--color-chalk)', fontWeight: 500 }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-abyss)', padding: '40px 16px', letterSpacing: '0.05em' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <img src="/newfavicon.png" alt="WTL" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--color-graphite)' }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-chalk)', letterSpacing: '0.1em' }}>WE THE LEADERS</div>
            <div style={{ fontSize: 11, color: 'var(--color-signal-mint)' }}>Voter Verification</div>
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--color-graphite)', color: 'var(--color-chalk)', padding: '8px 16px', borderRadius: '16px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}
            onMouseEnter={(e) => { e.target.style.borderColor = 'var(--color-ash)' }}
            onMouseLeave={(e) => { e.target.style.borderColor = 'var(--color-graphite)' }}
          >
            <i className="bi bi-arrow-left" /> Back
          </button>
        </div>

        {/* Verified badge */}
        {hasCard && (
          <div style={{ background: 'rgba(63, 226, 128, 0.05)', border: '1px solid var(--color-signal-mint)', borderRadius: 12, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <i className="bi bi-patch-check-fill" style={{ fontSize: 24, color: 'var(--color-signal-mint)' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-chalk)' }}>Verified Member</div>
              <div style={{ fontSize: 12, color: 'var(--color-ash)' }}>This person has generated their WTL ID card.</div>
            </div>
          </div>
        )}

        {/* Profile section */}
        <div style={{ background: 'var(--color-carbon)', border: '1px solid var(--color-graphite)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" style={{ width: 72, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-graphite)', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 72, height: 90, background: 'var(--color-abyss)', borderRadius: 6, border: '1px solid var(--color-graphite)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="bi bi-person" style={{ fontSize: 32, color: 'var(--color-ash)' }} />
              </div>
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-chalk)' }}>{v.name || v.Name || 'N/A'}</div>
              {(v.father_name || v.FatherName) && (
                <div style={{ fontSize: 12, color: 'var(--color-ash)' }}>S/o, D/o: {v.father_name || v.FatherName}</div>
              )}
              {(v.wtl_code || v.ptc_code) && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(63, 226, 128, 0.05)', border: '1px solid var(--color-signal-mint)', borderRadius: 20, padding: '2px 10px', fontSize: 11, color: 'var(--color-signal-mint)', fontWeight: 500, width: 'fit-content' }}>
                  <i className="bi bi-qr-code" /> WTL: {v.wtl_code || v.ptc_code}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderTop: '1px solid var(--color-graphite)', paddingTop: 16 }}>
            {[
              { label: 'EPIC No',  value: v.epic_no || epicNo },
              { label: 'Assembly', value: v.assembly || v.AssemblyName },
              { label: 'District', value: v.district || v.DistrictName },
              { label: 'Part No',  value: v.part_no || v.PartNo },
              { label: 'Age',      value: v.age || v.Age },
              { label: 'Gender',   value: v.gender || v.Gender },
            ].filter((f) => f.value).map((f) => (
              <div key={f.label} style={fieldStyle}>
                <span style={labelStyle}>{f.label}</span>
                <span style={valueStyle}>{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status tags */}
        {(isVolunteer || isBoothAgent) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {isVolunteer && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid var(--color-graphite)', borderRadius: 20, padding: '5px 12px', fontSize: 12, color: 'var(--color-signal-mint)', fontWeight: 500 }}>
                <i className="bi bi-hand-thumbs-up-fill" /> Volunteer
              </div>
            )}
            {isBoothAgent && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid var(--color-graphite)', borderRadius: 20, padding: '5px 12px', fontSize: 12, color: 'var(--color-signal-mint)', fontWeight: 500 }}>
                <i className="bi bi-building-fill-check" /> Booth Agent {v.booth_no ? `(Booth ${v.booth_no})` : ''}
              </div>
            )}
          </div>
        )}

        {/* Card preview */}
        {hasCard && (
          <div style={{ background: 'var(--color-carbon)', border: '1px solid var(--color-graphite)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-ash)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              <i className="bi bi-credit-card-2-front" /> Generated Card
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <CardPreviewIframe cardData={v} width={260} />
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center' }}>
          <a href={`/card/${epicNo}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--color-signal-mint)', color: 'var(--color-abyss)', padding: '10px 24px', borderRadius: '16px', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
            <i className="bi bi-eye" /> View Full Card
          </a>
        </div>
      </div>
    </div>
  )
}
