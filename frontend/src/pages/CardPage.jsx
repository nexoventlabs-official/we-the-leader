import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi } from '../api'
import { FlipCard3D } from '../components/FlipCard3D'

export default function CardPage() {
  const { epicNo } = useParams()
  const navigate   = useNavigate()
  const [card, setCard]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [cardWidth, setCardWidth] = useState(480)

  useEffect(() => {
    if (!epicNo) return
    publicApi.getCardData(epicNo)
      .then((data) => setCard(data))
      .catch((err) => setError(err.message || 'Card not found'))
      .finally(() => setLoading(false))
  }, [epicNo])

  useEffect(() => {
    const update = () => setCardWidth(Math.min(window.innerWidth - 48, 520))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner-border" role="status" style={{ color: 'var(--color-signal-mint)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, background:'var(--color-abyss)', color:'var(--color-chalk)', padding:24, textAlign:'center' }}>
        <i className="bi bi-exclamation-circle" style={{ fontSize:48, color:'var(--color-signal-mint)' }} />
        <h2 style={{ fontSize:20, fontWeight:500 }}>Card Not Found</h2>
        <p style={{ color:'var(--color-ash)', fontSize:14 }}>{error}</p>
        <button onClick={() => navigate('/')} style={{ background:'var(--color-signal-mint)', color:'var(--color-abyss)', border:'none', padding:'12px 24px', borderRadius:16, fontFamily:'inherit', fontSize:14, fontWeight:500, cursor:'pointer' }}>
          Go Back
        </button>
      </div>
    )
  }

  const cardData = card?.card || card || {}

  return (
    <div style={{ minHeight:'100vh', background:'var(--color-abyss)', display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 16px', gap:24 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <img src="/newfavicon.png" alt="WTL" style={{ width:40, height:40, borderRadius:'50%', border:'1px solid var(--color-graphite)' }} />
        <div>
          <div style={{ fontSize:16, fontWeight:500, color:'var(--color-chalk)', letterSpacing:'0.1em' }}>WE THE LEADERS</div>
          <div style={{ fontSize:11, color:'var(--color-signal-mint)' }}>Digital Member ID Card</div>
        </div>
      </div>

      {/* 3D Flip Card — auto-flips to back on open */}
      <FlipCard3D
        cardData={cardData}
        backUrl={cardData.back_url || ''}
        width={cardWidth}
        autoFlip={true}
        showActions={true}
      />

      {/* Extra actions */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
        <a
          href={`/verify/${epicNo}`}
          style={{ display:'inline-flex', alignItems:'center', gap:8, background:'transparent', border:'1px solid var(--color-graphite)', color:'var(--color-chalk)', padding:'10px 20px', borderRadius:16, fontSize:14, fontWeight:500, textDecoration:'none' }}
        >
          <i className="bi bi-patch-check-fill" style={{ color:'var(--color-signal-mint)' }} /> Verify
        </a>
        <button
          onClick={() => navigate('/')}
          style={{ display:'inline-flex', alignItems:'center', gap:8, background:'transparent', border:'1px solid var(--color-graphite)', color:'var(--color-chalk)', padding:'10px 20px', borderRadius:16, fontSize:14, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}
        >
          <i className="bi bi-house" /> Home
        </button>
      </div>
    </div>
  )
}
