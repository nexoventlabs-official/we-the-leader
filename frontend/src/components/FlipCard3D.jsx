import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

/**
 * FlipCard3D
 * ----------
 * Props:
 *  cardData  — voter/card data object
 *  backUrl   — Cloudinary URL of back card image (black_original1.png)
 *  width     — display width in px (default 320)
 *  autoFlip  — auto-rotates to back briefly after mount
 *  showActions — show download/view buttons
 */
export const FlipCard3D = forwardRef(function FlipCard3D(
  { cardData, backUrl, width = 320, autoFlip = false, showActions = true },
  ref
) {
  const [flipped, setFlipped]     = useState(false)
  const [downloading, setDownloading] = useState(false)
  const iframeRef = useRef(null)

  // Card original dimensions
  const ORIG_W = 1576
  const ORIG_H = 998
  const scale  = width / ORIG_W
  const height = Math.round(ORIG_H * scale)

  // Auto-flip: show back at 800ms, return at 2600ms
  useEffect(() => {
    if (!autoFlip) return
    const t1 = setTimeout(() => setFlipped(true),  800)
    const t2 = setTimeout(() => setFlipped(false), 2600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [autoFlip])

  useImperativeHandle(ref, () => ({
    flip:     () => setFlipped((f) => !f),
    download: () => handleDownload(),
  }))

  // ── Fill the iframe with card data ──────────────────────────────
  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (!iframe || !cardData) return
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document
      if (!doc) return

      // Hide the form panel
      const formPanel = doc.querySelector('.form-panel')
      if (formPanel) formPanel.style.display = 'none'

      // Remove all body/html padding so card fills the iframe exactly
      doc.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;height:998px'
      doc.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:transparent;display:block;min-height:0'

      // Remove card-wrap scaling — show at true 1:1 so iframe clip works
      const cardWrap = doc.querySelector('.card-wrap')
      if (cardWrap) {
        cardWrap.style.cssText = 'transform:none;margin:0;padding:0;flex-shrink:0'
      }

      // Populate fields
      const set = (id, val) => { const el = doc.getElementById(id); if (el) el.value = val }
      const name     = String(cardData.name || cardData.voter_name || cardData.VOTER_NAME || '')
                        .replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
      const epic     = String(cardData.epic_no || cardData.EPIC_NO || '').toUpperCase()
      const assembly = String(cardData.assembly_name || cardData.assembly || cardData.ASSEMBLY_NAME || '').toUpperCase()
      const booth    = String(cardData.part_no || cardData.booth_no || cardData.PART_NO || '')
      const district = String(cardData.district || cardData.DISTRICT || cardData.DISTRICT_NAME || '').toUpperCase()
      const wtlCode  = cardData.wtl_code || cardData.ptc_code || ''
      const midVal   = (wtlCode || (epic ? `WTL-${epic.slice(-6)}` : '')).toUpperCase()
      const photoUrl = cardData.photo_url || cardData.PHOTO_URL || ''

      set('f-name', name); set('f-epic', epic); set('f-asm', assembly)
      set('f-booth', booth); set('f-dist', district); set('f-mid', midVal)

      const photoImg = doc.getElementById('member-photo-img')
      const photoBox = doc.getElementById('photo-box')
      if (photoImg && photoUrl) {
        photoImg.src = photoUrl
        photoImg.style.display = 'block'
        if (photoBox) {
          const svg  = photoBox.querySelector('svg')
          const span = photoBox.querySelector('span')
          if (svg)  svg.style.display  = 'none'
          if (span) span.style.display = 'none'
        }
      }

      const qrImg = doc.getElementById('qr-img')
      if (qrImg && epic) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}/verify/${epic}`)}`
      }

      if (typeof iframe.contentWindow.generate === 'function') {
        iframe.contentWindow.generate()
      }

      // Hide first field-row decorators (icon/label/colon)
      const firstRow = doc.querySelector('.fields .field-row')
      if (firstRow) {
        ;['.field-icon', '.field-label', '.field-colon'].forEach(cls => {
          const el = firstRow.querySelector(cls)
          if (el) el.style.display = 'none'
        })
        const val = firstRow.querySelector('.field-value')
        if (val) val.style.maxWidth = '600px'
      }
    } catch (e) { console.error('FlipCard3D iframe error:', e) }
  }

  // ── Download: front (html2canvas) + back (image) side-by-side ──
  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) throw new Error('iframe not ready')

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
      const cardEl    = iframeDoc?.getElementById('card')
      if (!cardEl) throw new Error('card element not found')

      // Ensure html2canvas is loaded in the iframe
      const h2c = iframe.contentWindow.html2canvas
      if (!h2c) throw new Error('html2canvas not loaded')

      // 1. Capture front card via html2canvas (full res 1576×998)
      // Temporarily remove scaling so it captures at full size
      const wrap = iframeDoc.querySelector('.card-wrap')
      if (wrap) { wrap.style.transform = 'none'; wrap.style.margin = '0' }

      const frontCanvas = await h2c(cardEl, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#F9F8F6',
        width:  ORIG_W,
        height: ORIG_H,
      })

      // 2. Load back image
      let backCanvas = null
      if (backUrl) {
        backCanvas = await new Promise((resolve) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            // Scale back image to same height as front
            const bw = Math.round(img.naturalWidth  * (frontCanvas.height / img.naturalHeight))
            const bh = frontCanvas.height
            const c  = document.createElement('canvas')
            c.width  = bw
            c.height = bh
            c.getContext('2d').drawImage(img, 0, 0, bw, bh)
            resolve(c)
          }
          img.onerror = () => resolve(null)
          img.src = backUrl
        })
      }

      // 3. Combine side-by-side
      const GAP     = 40
      const totalW  = frontCanvas.width + (backCanvas ? GAP + backCanvas.width : 0)
      const totalH  = frontCanvas.height
      const combined = document.createElement('canvas')
      combined.width  = totalW
      combined.height = totalH
      const ctx = combined.getContext('2d')
      ctx.fillStyle = '#111111'
      ctx.fillRect(0, 0, totalW, totalH)
      ctx.drawImage(frontCanvas, 0, 0)
      if (backCanvas) ctx.drawImage(backCanvas, frontCanvas.width + GAP, 0)

      // 4. Trigger download
      const epic = String(cardData?.epic_no || cardData?.EPIC_NO || 'member').toUpperCase()
      const a    = document.createElement('a')
      a.download = `WTL_Card_${epic}.png`
      a.href     = combined.toDataURL('image/png', 1.0)
      a.click()
    } catch (err) {
      console.error('Download failed:', err)
      // Fallback: use iframe's own downloadPNG if our method fails
      const iframe = iframeRef.current
      if (iframe?.contentWindow?.downloadPNG) iframe.contentWindow.downloadPNG()
    } finally {
      setDownloading(false)
    }
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
          <div style={{ width: `${width}px`, height: `${height}px`, overflow: 'hidden', borderRadius: 12, position: 'relative', background: '#F9F8F6' }}>
            <iframe
              ref={iframeRef}
              src="/wtl_final_11.html"
              title="Card Front"
              style={{
                position: 'absolute', left: 0, top: 0,
                width: `${ORIG_W}px`, height: `${ORIG_H}px`,
                border: 'none',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                pointerEvents: 'none',
                maxWidth: 'none',
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
                <img src="/newlogo.png" alt="WTL" style={{ width: 60, marginBottom: 12, opacity: 0.8 }} onError={(e) => { e.target.style.display = 'none' }} />
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
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flip-action-btn flip-action-download"
          >
            {downloading
              ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12, borderWidth: 2 }} /> Preparing…</>
              : <><i className="bi bi-download" /> Download</>
            }
          </button>
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
