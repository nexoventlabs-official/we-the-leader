import React, { useRef, useEffect } from 'react'

export const CardPreviewIframe = React.forwardRef(({ cardData, width = 340 }, ref) => {
  const iframeRef = useRef(null)

  const download = () => {
    const iframe = iframeRef.current
    if (iframe && iframe.contentWindow && typeof iframe.contentWindow.downloadPNG === 'function') {
      iframe.contentWindow.downloadPNG()
    }
  }

  React.useImperativeHandle(ref, () => ({
    download
  }))

  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (!iframe || !cardData) return

    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document
      if (!doc) return

      // Hide the form panel
      const formPanel = doc.querySelector('.form-panel')
      if (formPanel) {
        formPanel.style.display = 'none'
      }

      // Format body for transparent, borderless container
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

      // Populate input values
      const nameInput = doc.getElementById('f-name')
      const epicInput = doc.getElementById('f-epic')
      const asmInput = doc.getElementById('f-asm')
      const boothInput = doc.getElementById('f-booth')
      const distInput = doc.getElementById('f-dist')
      const midInput = doc.getElementById('f-mid')
      const photoImg = doc.getElementById('member-photo-img')
      const qrImg = doc.getElementById('qr-img')

      const name = String(cardData.name || cardData.voter_name || cardData.VOTER_NAME || '').toUpperCase()
      const epic = String(cardData.epic_no || cardData.EPIC_NO || '').toUpperCase()
      const assembly = String(cardData.assembly_name || cardData.assembly || cardData.ASSEMBLY_NAME || '').toUpperCase()
      const booth = String(cardData.part_no || cardData.booth_no || cardData.PART_NO || '')
      const district = String(cardData.district || cardData.DISTRICT || cardData.DISTRICT_NAME || '').toUpperCase()
      const ptcCode = cardData.ptc_code || cardData.PTC_CODE || ''
      const midVal = ptcCode || (epic ? `WTL-${epic.slice(-6)}` : '')
      const photoUrl = cardData.photo_url || cardData.PHOTO_URL || ''

      if (nameInput) nameInput.value = name
      if (epicInput) epicInput.value = epic
      if (asmInput) asmInput.value = assembly
      if (boothInput) boothInput.value = booth
      if (distInput) distInput.value = district
      if (midInput) midInput.value = midVal.toUpperCase()

      if (photoImg && photoUrl) {
        photoImg.src = photoUrl
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

      if (qrImg && epic) {
        const verifyUrl = `${window.location.origin}/verify/${epic}`
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`
      }

      // Trigger generate card preview inside template
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
      console.error('Error pre-filling preview iframe:', e)
    }
  }

  // Calculate scale based on target width (card original width is 1576)
  const scale = width / 1576
  const height = Math.round(998 * scale)

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      overflow: 'hidden',
      position: 'relative',
      borderRadius: '12px',
      border: '1px solid var(--color-graphite)',
      background: '#F9F8F6',
    }}>
      <iframe
        ref={iframeRef}
        src="/wtl_final_11.html"
        title="Card Preview"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '1576px',
          height: '998px',
          border: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          maxWidth: 'none',
        }}
        onLoad={handleIframeLoad}
      />
    </div>
  )
})
