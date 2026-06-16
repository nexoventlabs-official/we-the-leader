import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

/**
 * FlipCard3D
 * ----------
 * Props:
 *  cardData   — voter/card data object (for front iframe preview)
 *  backUrl    — URL of the back card image (black_original1.png from Cloudinary)
 *  width      — display width in px (default 320)
 *  autoFlip   — if true, auto-rotates to back after mount then flips back
 *  onDownload — called when download button clicked (receives 'combined'|'front'|'back')
 */
export const FlipCard3D = forwardRef(function FlipCard3D(
  { cardData, backUrl, width = 320, autoFlip = false, showActions = true },
  ref
) {
  const [flipped, setFlipped] = useState(false)
  const iframeRef = useRef(null)

  // Aspect ratio matches front card: 1581×995
  const ORIG_W = 1576
  const ORIG_H = 998
  const scale  = width / ORIG_W
  const height = Math.round(ORIG_H * scale)

  // Auto-flip: show back briefly after mount then return to front
  useEffect(() => {
    if (!autoFlip) return
    const t1 = setTimeout(() => setFlipped(true),  800)
    const t2 = setTimeout(() => setFlipped(false), 2600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [autoFlip])

  // Expose flip toggle and download to parent
  useImperativeHandle(ref, () => ({
    flip:     () => setFlipped((f) => !f),
    download: () => {
      const iframe = iframeRef.current
      if (iframe?.contentWindow?.downloadPNG) iframe.contentWindow.downloadPNG()
    },
  }))

  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (!iframe || !cardData) return
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document
      if (!doc) return

      const formPanel = doc.querySelector('.form-panel')
      if (formPanel) formPanel.style.display = 'none'

      doc.body.style.cssText = 'background:transparent;padding:0;margin:0;overflow:hidden'
      const cardWrap = doc.querySelector('.card-wrap')
      if (cardWrap) { cardWrap.style.transform = 'none'; cardWrap.style.margin = '0' }

      const set = (id, val) => { const el = doc.getElementById(id); if (el) el.value = val }
      const name     = String(cardData.name || cardData.voter_name || cardData.VOTER_NAME || '')
                        .replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
      const epic     = String(cardData.epic_no || cardData.EPIC_NO || '').toUpperCase()
      const assembly = String(cardData.assembly_name || cardData.assembly || cardData.ASSEMBLY_NAME || '').toUpperCase()
      const booth    = String(cardData.part_no || cardData.booth_no || cardData.PART_NO || '')
      const district = String(cardData.district || cardData.DISTRICT || cardData.DISTRICT_NAME || '').toUpperCase()
      const ptcCode  = cardData.ptc_code || ''
      const midVal   = (ptcCode || (epic ? `WTL-${epic.slice(-6)}` : '')).toUpperCase()
      const photoUrl = cardData.photo_url || cardData.PHOTO_URL || ''

      set('f-name', name); set('f-epic', epic); set('f-asm', assembly)
      set('f-booth', booth); set('f-dist', district); set('f-mid', midVal)

      const photoImg = doc.getElementById('member-photo-img')
      const photoBox = doc.getElementById('photo-box')
      if (photoImg && photoUrl) {
        photoImg.src = photoUrl; photoImg.style.display = 'block'
        if (photoBox) {
          const svg = photoBox.querySelector('svg'); const span = photoBox.querySelector('span')
          if (svg) svg.style.display = 'none'; if (span) span.style.display = 'none'
        }
      }

      const qrImg = doc.getElementById('qr-img')
      if (qrImg && epic) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}/verify/${epic}`)}`
      }

      if (typeof iframe.contentWindow.generate === 'function') iframe.contentWindow.generate()

      // Clean up first field row labels
      const firstRow = doc.querySelector('.fields .field-row')
      if (firstRow) {
        ['field-icon','field-label','field-colon'].forEach(cls => {
          const el = firstRow.querySelector(`.${cls}`); if (el) el.style.display = 'none'
        })
        const val = firstRow.querySelector('.field-value')
        if (val) val.style.maxWidth = '600px'
      }
    } catch (e) { console.error('FlipCard3D iframe error:', e) }
  }

  const cardStyle = { width: `${width}px`, height: `${height}px` }

  return (
    <div className="flip-card-wrapper" style={{ width: `${width}px` }}>

      {/* 3D scene */}
      <div
        className={`flip-card-scene ${flipped ? 'is-flipped' : ''}`}
        style={cardStyle}
        onClick={() => setFlipped((f) => !f)}
        title="Click to flip"
      >
        {/* FRONT */}
        <div className="flip-card-face flip-card-front" style={cardStyle}>
          <div style={{ width: `${width}px`, height: `${height}px`, overflow: 'hidden', borderRadius: 12, position: 'relative' }}>
            <iframe
              ref={iframeRef}
              src="/wtl_final_11.html"
              title="Card Front"
              style={{
                position: 'absolute', left: 0, top: 0,
                width: `${ORIG_W}px`, height: `${ORIG_H}px`,
                border: 'none',
                transform: `scale(${scale})`, transformOrigin: 'top left',
                pointerEvents: 'none', maxWidth: 'none',
              }}
              onLoad={handleIframeLoad}
            />
          </div>
        </div>

        {/* BACK */}
        <div className="flip-card-face flip-card-back" style={cardStyle}>
          <div style={{ width: `${width}px`, height: `${height}px`, borderRadius: 12, overflow: 'hidden', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {backUrl ? (
              <img
                src={backUrl}
                alt="Card Back"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: '#ffffff', padding: 16 }}>
                <img src="/newlogo.png" alt="WTL" style={{ width: 60, marginBottom: 12, opacity: 0.8 }} onError={(e) => { e.target.style.display='none' }} />
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.15em' }}>WE THE LEADERS</div>
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Lead the Change</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Flip hint */}
      <div className="flip-card-hint">
        <i className="bi bi-arrow-repeat" /> tap to flip
      </div>

      {showActions && (
        <div className="flip-card-actions">
          <a
            href={cardData?.combined_url || cardData?.card_url || '#'}
            download={`WTL_Card_${cardData?.epic_no || 'member'}.jpg`}
            target="_blank"
            rel="noreferrer"
            className="flip-action-btn flip-action-download"
          >
            <i className="bi bi-download" /> Download
          </a>
          <a
            href={`/card/${cardData?.epic_no}`}
            target="_blank"
            rel="noreferrer"
            className="flip-action-btn"
          >
            <i className="bi bi-eye" /> Full View
          </a>
        </div>
      )}
    </div>
  )
})
