import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi } from '../api'

export default function CardPage() {
  const { epicNo } = useParams()
  const navigate = useNavigate()
  const [card, setCard]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const iframeRef = useRef(null)

  const [scale, setScale] = useState(0.61)

  useEffect(() => {
    if (!epicNo) return
    publicApi.getCardData(epicNo)
      .then((data) => setCard(data))
      .catch((err) => setError(err.message || 'Card not found'))
      .finally(() => setLoading(false))
  }, [epicNo])

  useEffect(() => {
    const updateScale = () => {
      const width = Math.min(window.innerWidth - 32, 1000)
      setScale(width / 1576)
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [])

  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (!iframe || !card) return

    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document
      if (!doc) return

      // Hide the form panel
      const formPanel = doc.querySelector('.form-panel')
      if (formPanel) {
        formPanel.style.display = 'none'
      }

      // Format body
      doc.body.style.background = 'transparent'
      doc.body.style.padding = '0'
      doc.body.style.margin = '0'
      doc.body.style.display = 'block'
      doc.body.style.overflow = 'hidden'

      const cardWrap = doc.querySelector('.card-wrap')
      if (cardWrap) {
        cardWrap.style.transform = 'none'
        cardWrap.style.margin = '0'
        cardWrap.style.marginBottom = '0'
      }

      const cardData = card?.card || card || {}

      // Set input values in the wtl_final_11.html form
      const nameInput = doc.getElementById('f-name')
      const epicInput = doc.getElementById('f-epic')
      const asmInput = doc.getElementById('f-asm')
      const boothInput = doc.getElementById('f-booth')
      const distInput = doc.getElementById('f-dist')
      const midInput = doc.getElementById('f-mid')
      const photoImg = doc.getElementById('member-photo-img')
      const qrImg = doc.getElementById('qr-img')

      if (nameInput) nameInput.value = String(cardData.name || '').toUpperCase()
      if (epicInput) epicInput.value = String(cardData.epic_no || '').toUpperCase()
      if (asmInput) asmInput.value = String(cardData.assembly_name || '').toUpperCase()
      if (boothInput) boothInput.value = String(cardData.part_no || '') // USE PART_NO AS BOOTH_NO!
      if (distInput) distInput.value = String(cardData.district || '').toUpperCase()

      const ptcCode = cardData.ptc_code || ''
      const midVal = ptcCode || `WTL-${String(cardData.epic_no || '').slice(-6)}`
      if (midInput) midInput.value = midVal.toUpperCase()

      if (photoImg && cardData.photo_url) {
        photoImg.src = cardData.photo_url
        photoImg.style.display = 'block'
        const photoBox = doc.getElementById('photo-box')
        if (photoBox) {
          const svg = photoBox.querySelector('svg')
          const span = photoBox.querySelector('span')
          if (svg) svg.style.display = 'none'
          if (span) span.style.display = 'none'
        }
      } else if (photoImg) {
        photoImg.style.display = 'none'
        const photoBox = doc.getElementById('photo-box')
        if (photoBox) {
          const svg = photoBox.querySelector('svg')
          const span = photoBox.querySelector('span')
          if (svg) svg.style.display = 'block'
          if (span) span.style.display = 'block'
        }
      }

      if (qrImg) {
        const verifyUrl = `${window.location.origin}/verify/${cardData.epic_no}`
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`
      }

      // Trigger the template's internal generate function to update visual fields
      if (iframe.contentWindow && typeof iframe.contentWindow.generate === 'function') {
        iframe.contentWindow.generate()
      }

      // Hide profile icon, NAME label, and colon for the first field row, and let the name slide left
      const firstRow = doc.querySelector('.fields .field-row')
      if (firstRow) {
        const icon = firstRow.querySelector('.field-icon')
        const label = firstRow.querySelector('.field-label')
        const colon = firstRow.querySelector('.field-colon')
        const val = firstRow.querySelector('.field-value')
        if (icon) icon.style.display = 'none'
        if (label) label.style.display = 'none'
        if (colon) colon.style.display = 'none'
        if (val) {
          val.style.maxWidth = '600px'
        }
      }
    } catch (e) {
      console.error('Error pre-filling iframe:', e)
    }
  }

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner-border text-success" role="status" style={{ color: 'var(--color-signal-mint)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--color-abyss)', color: 'var(--color-chalk)', padding: 24, textAlign: 'center', letterSpacing: '0.05em' }}>
        <i className="bi bi-exclamation-circle" style={{ fontSize: 48, color: 'var(--color-signal-mint)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Card Not Found</h2>
        <p style={{ color: 'var(--color-ash)', fontSize: 14 }}>{error}</p>
        <button onClick={() => navigate('/')} style={{ background: 'var(--color-signal-mint)', color: 'var(--color-abyss)', border: 'none', padding: '12px 24px', borderRadius: '16px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-abyss)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px',
      gap: 16,
      letterSpacing: '0.05em',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <img src="/newfavicon.png" alt="WTL" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--color-graphite)' }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-chalk)', letterSpacing: '0.1em' }}>WE THE LEADERS</div>
          <div style={{ fontSize: 11, color: 'var(--color-signal-mint)' }}>[console: card_viewer]</div>
        </div>
      </div>

      {/* Embedded Template Iframe */}
      <div style={{
        width: '100%',
        maxWidth: '1000px',
        height: `${Math.round(998 * scale)}px`,
        overflow: 'hidden',
        borderRadius: '16px',
        border: '1px solid var(--color-graphite)',
        background: '#F9F8F6',
        position: 'relative',
      }}>
        <iframe
          ref={iframeRef}
          src="/wtl_final_11.html"
          title="Member Card Template"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '1576px',
            height: '998px',
            border: 'none',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            maxWidth: 'none',
          }}
          onLoad={handleIframeLoad}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => {
            if (iframeRef.current && iframeRef.current.contentWindow && typeof iframeRef.current.contentWindow.downloadPNG === 'function') {
              iframeRef.current.contentWindow.downloadPNG()
            }
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--color-signal-mint)', color: 'var(--color-abyss)', border: 'none', padding: '10px 20px', borderRadius: '16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}
        >
          <i className="bi bi-download" /> Download PNG
        </button>
        <a
          href={`/verify/${epicNo}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid var(--color-graphite)', color: 'var(--color-chalk)', padding: '10px 20px', borderRadius: '16px', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'all 0.15s' }}
        >
          <i className="bi bi-patch-check-fill" style={{ color: 'var(--color-signal-mint)' }} /> Verify Report
        </a>
        <button
          onClick={() => navigate('/')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid var(--color-graphite)', color: 'var(--color-chalk)', padding: '10px 20px', borderRadius: '16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}
        >
          <i className="bi bi-house" /> Return Home
        </button>
      </div>
    </div>
  )
}
