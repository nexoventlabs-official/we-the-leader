import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { chat, publicApi } from '../api'
import { FlipCard3D } from '../components/FlipCard3D'
import '../styles/chatbot.css'

// ── Constants ──────────────────────────────────────────────
const S = {
  WELCOME:       'WELCOME',
  AWAIT_MOBILE:  'AWAIT_MOBILE',
  AWAIT_EPIC:    'AWAIT_EPIC',
  CONFIRM:       'CONFIRM',
  AWAIT_PHOTO:   'AWAIT_PHOTO',
  GENERATING:    'GENERATING',
  DONE:          'DONE',
  AWAIT_BOOTH_NO:'AWAIT_BOOTH_NO',
}

const CACHE_KEY = 'wtl_card_cache'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

const getCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (Date.now() - data.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return data
  } catch { return null }
}

const saveCache = (card, profile) =>
  localStorage.setItem(CACHE_KEY, JSON.stringify({ card, profile, timestamp: Date.now() }))

const clearCache = () => localStorage.removeItem(CACHE_KEY)

const maskMobile = (m) => m ? m.slice(0, 5) + 'XXXXX' : ''

const getDownloadUrl = (url, epicNo) => {
  if (url && url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/fl_attachment:${epicNo}_WTL_Card/`)
  }
  return url
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

const getActiveStep = (chatState) => {
  switch (chatState) {
    case 'WELCOME':
    case 'AWAIT_MOBILE':
      return 1
    case 'AWAIT_EPIC':
    case 'CONFIRM':
      return 2
    case 'AWAIT_PHOTO':
    case 'GENERATING':
      return 3
    case 'DONE':
      return 4
    default:
      return 1
  }
}

// ── Crop Modal ──────────────────────────────────────────────
function CropModal({ src, onCrop, onCancel }) {
  const imgRef = useRef(null)
  const cropperRef = useRef(null)

  useEffect(() => {
    if (!imgRef.current || !src) return
    const img = imgRef.current

    const initCropper = () => {
      cropperRef.current = new Cropper(img, {
        aspectRatio: 268 / 384,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.9,
        responsive: true,
        background: false,
        guides: true,
        center: true,
      })
    }

    if (img.complete) {
      initCropper()
    } else {
      img.onload = initCropper
    }

    return () => {
      cropperRef.current?.destroy()
      cropperRef.current = null
    }
  }, [src])

  const handleCrop = () => {
    if (!cropperRef.current) return
    cropperRef.current.getCroppedCanvas({ width: 536, height: 768, imageSmoothingQuality: 'high' })
      .toBlob((blob) => onCrop(blob), 'image/jpeg', 0.93)
  }

  return (
    <div className="crop-overlay">
      <div className="crop-modal">
        <div className="crop-modal-header">
          <h5><i className="bi bi-crop" /> Crop Your Photo</h5>
          <button className="crop-close-btn" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="crop-modal-body">
          <img ref={imgRef} src={src} alt="Crop preview" style={{ display: 'block', maxWidth: '100%' }} />
        </div>
        <div className="crop-modal-footer">
          <span className="crop-hint"><i className="bi bi-info-circle" /> Drag to adjust. Aspect ratio 2.68:3.84.</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-danger" onClick={handleCrop}>
            <i className="bi bi-check-lg" /> Use Photo
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Message renderers ───────────────────────────────────────
function WelcomeBannerMsg({ onStart }) {
  return (
    <div className="welcome-banner">
      <img src="/banner.png" alt="We The Leaders" className="banner-img"
        onError={(e) => { e.target.style.display = 'none' }} />
      <div className="banner-content">
        <h2>Welcome to We The Leaders!</h2>
        <p>Lead the Change — Your Digital Member ID Card Generator</p>
        <button className="btn-start" onClick={onStart}>
          <i className="bi bi-play-circle-fill" /> Start
        </button>
      </div>
    </div>
  )
}

function VoterCardMsg({ voter, isLatest, chatState, onConfirm, onRetry, disabled }) {
  const v = voter || {}
  const rows = [
    { label: 'Name',         value: v.name || v.Name || v.voter_name },
    { label: "Father's Name", value: v.father_name || v.FatherName || v.RelationName },
    { label: 'EPIC No',       value: v.epic_no || v.EpicNo || v.EPIC_NO },
    { label: 'Age / Gender',  value: [v.age || v.Age, v.gender || v.Gender].filter(Boolean).join(' / ') || undefined },
    { label: 'Assembly',      value: v.assembly || v.AssemblyName || v.assembly_name },
    { label: 'District',      value: v.district || v.DistrictName || v.district_name },
    { label: 'Part No',       value: v.part_no || v.PartNo },
    { label: 'Serial No',     value: v.serial_no || v.SlNo },
  ].filter((r) => r.value)

  const showButtons = isLatest && chatState === 'CONFIRM'

  return (
    <div className="voter-details-card">
      <div className="vdc-header">
        <i className="bi bi-person-badge" /> Voter Details
      </div>
      <div className="vdc-body">
        {rows.map((r) => (
          <div className="vdc-row" key={r.label}>
            <span className="vdc-label">{r.label}</span>
            <span className="vdc-value">{r.value}</span>
          </div>
        ))}
      </div>
      {showButtons && (
        <div className="interactive-buttons">
          <button className="interactive-btn" onClick={onConfirm} disabled={disabled}>
            <i className="bi bi-check-circle-fill" /> Confirm Details
          </button>
          <button className="interactive-btn" onClick={onRetry} disabled={disabled} style={{ color: '#d32f2f' }}>
            <i className="bi bi-arrow-counterclockwise" /> Re-enter ID
          </button>
        </div>
      )}
    </div>
  )
}

function GeneratedCardMsg({ card, isNew = false }) {
  const c = card || {}
  const [fullCardData, setFullCardData] = useState(null)

  useEffect(() => {
    if (c.name && c.assembly_name) {
      setFullCardData(c)
    } else if (c.epic_no) {
      publicApi.getCardData(c.epic_no)
        .then((data) => setFullCardData(data))
        .catch(() => setFullCardData(c))
    }
  }, [c])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      {fullCardData ? (
        <FlipCard3D
          cardData={fullCardData}
          backUrl={c.back_url || fullCardData.back_url}
          width={300}
          autoFlip={isNew}
          showActions={true}
        />
      ) : (
        <div style={{
          background: '#1f2c34', width: 300, height: 190,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#8696a0', fontSize: 12, borderRadius: 12,
          border: '1px solid var(--color-graphite)'
        }}>
          Loading preview…
        </div>
      )}
    </div>
  )
}

// ── Main ChatbotPage ────────────────────────────────────────
export default function ChatbotPage() {
  const navigate = useNavigate()
  const [chatState, setChatState]   = useState(S.WELCOME)
  const [messages, setMessages]     = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping]     = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isFlipped, setIsFlipped]   = useState(false)
  const [cropSrc, setCropSrc]       = useState('')
  const [cropOpen, setCropOpen]     = useState(false)

  // Persistent refs (avoid stale closures)
  const initializedRef = useRef(false)
  const mobileRef   = useRef('')
  const epicRef     = useRef('')
  const cardRef     = useRef(null)
  const profileRef  = useRef(null)
  const voterRef    = useRef(null)
  const stateRef    = useRef(S.WELCOME)

  const messagesEndRef  = useRef(null)
  const fileInputRef    = useRef(null)
  const cameraInputRef  = useRef(null)

  // Keep stateRef synced
  useEffect(() => { stateRef.current = chatState }, [chatState])

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // ── Message helpers ───────────────────────────────────────
  const addMsg = useCallback((from, type, payload = {}) => {
    setMessages((prev) => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from, type, ...payload,
      ts: new Date(),
    }])
  }, [])

  const botSay = useCallback(async (text, delay = 500) => {
    setIsTyping(true)
    await sleep(delay)
    setIsTyping(false)
    addMsg('bot', 'text', { text })
  }, [addMsg])

  // ── Initialise ────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const cache = getCache()
    if (cache?.card) {
      cardRef.current    = cache.card
      profileRef.current = cache.profile || {}
      epicRef.current    = cache.card.epic_no || ''
      // Note: mobile is NOT stored in localStorage for PII protection
      addMsg('bot', 'text', { text: '👋 Welcome back to *We The Leaders!*' })
      setTimeout(() => {
        addMsg('bot', 'generated_card', { card: cache.card })
        setChatState(S.DONE)
      }, 300)
    } else {
      addMsg('bot', 'welcome_banner', {})
      setChatState(S.WELCOME)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Flow handlers ─────────────────────────────────────────
  const handleStart = async () => {
    addMsg('user', 'text', { text: 'Start' })
    setChatState(S.AWAIT_MOBILE)
    await botSay('📱 Please enter your 10-digit mobile number to get started.', 400)
  }

  const handleMobileSubmit = async () => {
    const mobile = inputValue.trim()
    if (!/^\d{10}$/.test(mobile)) {
      await botSay('❌ Please enter a valid 10-digit mobile number.', 300)
      return
    }
    mobileRef.current = mobile
    addMsg('user', 'text', { text: maskMobile(mobile) })
    setInputValue('')
    // Skip OTP — go straight to EPIC
    await botSay('✅ Mobile saved! Now enter your EPIC Number (Voter ID).', 400)
    await botSay('📋 Format: 3 letters + 7 digits  e.g. ABC1234567', 200)
    setChatState(S.AWAIT_EPIC)
  }

  const handleEpicSubmit = async () => {
    const epic = inputValue.trim().toUpperCase()
    if (!/^[A-Z]{3}\d{7}$/.test(epic)) {
      await botSay('❌ Invalid format. Use 3 letters + 7 digits (e.g., ABC1234567).', 300)
      return
    }
    epicRef.current = epic
    addMsg('user', 'text', { text: epic })
    setInputValue('')
    setIsTyping(true)
    try {
      const res = await chat.validateEpic(epic)
      await sleep(200)
      setIsTyping(false)
      const voter = res.voter || res.data || res
      if (!voter || (!voter.name && !voter.Name && !voter.voter_name)) {
        throw new Error('Voter data not found in response')
      }
      voterRef.current = voter
      await botSay('✅ Voter found! Please confirm your details:', 200)
      addMsg('bot', 'voter_card', { voter })
      setChatState(S.CONFIRM)
    } catch (err) {
      setIsTyping(false)
      await botSay(`❌ ${err.message || 'EPIC not found. Please check and try again.'}`, 200)
    }
  }

  const handleConfirm = async () => {
    addMsg('user', 'text', { text: '✓ Confirmed' })
    await botSay('📸 Please upload your recent passport-size photo to generate your card.', 400)
    setChatState(S.AWAIT_PHOTO)
  }

  const handleRetry = async () => {
    addMsg('user', 'text', { text: '↩ Try Again' })
    epicRef.current = ''
    voterRef.current = null
    await botSay('📋 Please enter your EPIC Number again.', 300)
    setChatState(S.AWAIT_EPIC)
  }

  const handleFileSelect = (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      botSay('❌ Please select an image file (JPG, PNG, etc.).', 200)
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => { setCropSrc(e.target.result); setCropOpen(true) }
    reader.readAsDataURL(file)
  }

  const handleCropComplete = async (blob) => {
    setCropOpen(false)
    setCropSrc('')
    addMsg('user', 'text', { text: '📸 Photo uploaded' })
    setChatState(S.GENERATING)
    await botSay('⏳ Generating your card… This may take up to a minute.', 400)

    try {
      const formData = new FormData()
      formData.append('epic_no', epicRef.current)
      formData.append('mobile', mobileRef.current)
      formData.append('photo', blob, 'photo.jpg')

      const res = await chat.generateCard(formData)

      const card = {
        card_url:     res.card_url,
        back_url:     res.back_url,
        combined_url: res.combined_url,
        epic_no:      res.epic_no || epicRef.current,
        ptc_code:     res.ptc_code,
        name:         voterRef.current?.name || voterRef.current?.VOTER_NAME || res.voter_name,
        assembly_name:voterRef.current?.assembly_name || voterRef.current?.assembly || voterRef.current?.ASSEMBLY_NAME,
        district:     voterRef.current?.district || voterRef.current?.DISTRICT || voterRef.current?.DISTRICT_NAME,
        part_no:      voterRef.current?.part_no || voterRef.current?.PartNo || voterRef.current?.PART_NO,
        photo_url:    res.photo_url || voterRef.current?.photo_url
      }
      cardRef.current = card
      saveCache(card, profileRef.current || {})

      await botSay('🎉 Your card is ready!', 200)
      addMsg('bot', 'generated_card', { card, isNew: true })
      setChatState(S.DONE)
    } catch (err) {
      setChatState(S.AWAIT_PHOTO)
      await botSay(`❌ ${err.message || 'Error generating card. Please try uploading your photo again.'}`, 200)
    }
  }

  const handleBoothNoSubmit = async () => {
    const boothNo = inputValue.trim()
    if (!boothNo) return
    const ptcCode = cardRef.current?.ptc_code || profileRef.current?.ptc_code
    addMsg('user', 'text', { text: `Booth No: ${boothNo}` })
    setInputValue('')
    setIsTyping(true)
    try {
      const res = await chat.requestBoothAgent(ptcCode, epicRef.current, boothNo)
      setIsTyping(false)
      await botSay(res.message || '✅ Booth Agent request submitted! Admin will review it shortly.', 200)
    } catch (err) {
      setIsTyping(false)
      await botSay(`ℹ️ ${err.message || 'Unable to submit request. Please try again.'}`, 200)
    }
    setChatState(S.DONE)
  }

  // ── Sidebar actions ───────────────────────────────────────
  const handleSidebarAction = async (action) => {
    setSidebarOpen(false)
    const ptcCode = cardRef.current?.ptc_code || profileRef.current?.ptc_code

    switch (action) {
      case 'profile': {
        if (!epicRef.current) { await botSay('ℹ️ No profile data available.', 200); return }
        setIsTyping(true)
        try {
          const res = await chat.profile(epicRef.current, mobileRef.current)
          setIsTyping(false)
          addMsg('bot', 'profile_card', { profile: res })
        } catch {
          setIsTyping(false)
          await botSay('❌ Unable to load profile.', 200)
        }
        break
      }
      case 'my_card': {
        if (cardRef.current) addMsg('bot', 'generated_card', { card: cardRef.current })
        else await botSay('ℹ️ No card generated yet.', 200)
        break
      }
      case 'booth_info': {
        if (!epicRef.current) { await botSay('ℹ️ No booth data available.', 200); return }
        setIsTyping(true)
        try {
          const res = await chat.getBooth(epicRef.current)
          setIsTyping(false)
          addMsg('bot', 'booth_info', { booth: res })
        } catch {
          setIsTyping(false)
          await botSay('❌ Unable to load booth information.', 200)
        }
        break
      }
      case 'referral': {
        if (!ptcCode) { await botSay('ℹ️ Referral link unavailable.', 200); return }
        setIsTyping(true)
        try {
          const res = await chat.getReferralLink(ptcCode)
          setIsTyping(false)
          const link = res.link || res.referral_link || res.url
          addMsg('bot', 'referral_link', { link, ptcCode })
        } catch {
          setIsTyping(false)
          await botSay('❌ Unable to load referral link.', 200)
        }
        break
      }
      case 'my_members': {
        if (!ptcCode) { await botSay('ℹ️ Members list unavailable.', 200); return }
        setIsTyping(true)
        try {
          const res = await chat.getMyMembers(ptcCode)
          setIsTyping(false)
          const members = res.members || res.data || (Array.isArray(res) ? res : [])
          addMsg('bot', 'members_list', { members })
        } catch {
          setIsTyping(false)
          await botSay('❌ Unable to load members.', 200)
        }
        break
      }
      case 'volunteer': {
        if (!ptcCode || !epicRef.current) { await botSay('ℹ️ Volunteer request unavailable.', 200); return }
        setIsTyping(true)
        try {
          const res = await chat.requestVolunteer(ptcCode, epicRef.current)
          setIsTyping(false)
          await botSay(res.message || '✅ Volunteer request submitted! Admin will review it shortly.', 200)
        } catch (err) {
          setIsTyping(false)
          await botSay(`ℹ️ ${err.message || 'Unable to submit volunteer request.'}`, 200)
        }
        break
      }
      case 'booth_agent': {
        await botSay('🏛️ Please enter your Booth Number to request Booth Agent status:', 300)
        setChatState(S.AWAIT_BOOTH_NO)
        break
      }
      default: break
    }
  }

  const handleLogout = () => {
    clearCache()
    mobileRef.current  = ''
    epicRef.current    = ''
    cardRef.current    = null
    profileRef.current = null
    voterRef.current   = null
    setSidebarOpen(false)
    setIsFlipped(false)
    setInputValue('')
    setMessages([])
    setTimeout(() => {
      addMsg('bot', 'welcome_banner', {})
      setChatState(S.WELCOME)
    }, 50)
  }

  // ── Input config ──────────────────────────────────────────
  const getInputCfg = () => {
    switch (chatState) {
      case S.AWAIT_MOBILE:
        return { type: 'tel', placeholder: 'Enter 10-digit mobile number', maxLength: 10, inputMode: 'numeric' }
      case S.AWAIT_EPIC:
        return { type: 'text', placeholder: 'EPIC Number (e.g. ABC1234567)', maxLength: 10 }
      case S.AWAIT_BOOTH_NO:
        return { type: 'text', placeholder: 'Enter your Booth Number', maxLength: 30 }
      default: return null
    }
  }

  const handleInputChange = (e) => {
    let val = e.target.value
    if (chatState === S.AWAIT_EPIC) {
      val = val.toUpperCase().replace(/[^A-Z0-9]/g, '')
      const letters = val.slice(0, 3).replace(/[^A-Z]/g, '')
      const digits  = val.slice(3).replace(/[^0-9]/g, '').slice(0, 7)
      val = letters + digits
    } else if (chatState === S.AWAIT_MOBILE) {
      val = val.replace(/\D/g, '')
    }
    setInputValue(val)
  }

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!inputValue.trim() || isTyping) return
    switch (chatState) {
      case S.AWAIT_MOBILE:   await handleMobileSubmit(); break
      case S.AWAIT_EPIC:     await handleEpicSubmit(); break
      case S.AWAIT_BOOTH_NO: await handleBoothNoSubmit(); break
      default: break
    }
  }

  // ── Render message content ────────────────────────────────
  const renderMsgContent = (msg) => {
    switch (msg.type) {
      case 'text': {
        // HTML-escape text before applying bold markdown to prevent XSS
        const escapeHtml = (s) => String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
        const safeHtml = escapeHtml(msg.text || '').replace(/\*(.*?)\*/g, '<strong>$1</strong>')
        return <span dangerouslySetInnerHTML={{ __html: safeHtml }} />
      }
      case 'welcome_banner':
        return <WelcomeBannerMsg onStart={handleStart} />
      case 'voter_card': {
        const isLatest = messages[messages.length - 1]?.id === msg.id
        return (
          <VoterCardMsg
            voter={msg.voter}
            isLatest={isLatest}
            chatState={chatState}
            onConfirm={handleConfirm}
            onRetry={handleRetry}
            disabled={isTyping}
          />
        )
      }
      case 'generated_card':
        return <GeneratedCardMsg card={msg.card} isNew={msg.isNew || false} />
      case 'profile_card':
        return (
          <div className="profile-card">
            {msg.profile?.photo_url && (
              <img src={msg.profile.photo_url} alt="Profile" className="profile-photo" />
            )}
            <div className="profile-details">
              <h4>{msg.profile?.name || 'Member'}</h4>
              <p>{[msg.profile?.assembly, msg.profile?.district].filter(Boolean).join(', ')}</p>
              {(msg.profile?.epic_no || epicRef.current) && <p>EPIC: {msg.profile?.epic_no || epicRef.current}</p>}
              {msg.profile?.ptc_code && <p className="ptc">PTC: {msg.profile.ptc_code}</p>}
            </div>
          </div>
        )
      case 'booth_info': {
        const booth = msg.booth || {}
        const entries = Object.entries(booth).filter(([, v]) => v !== null && v !== undefined && v !== '')
        return (
          <div className="info-card booth-card">
            <div className="info-card-header"><i className="bi bi-building" /> Booth Information</div>
            <div className="vdc-body">
              {entries.length > 0 ? entries.map(([k, v]) => (
                <div className="vdc-row" key={k}>
                  <span className="vdc-label">{k.replace(/_/g, ' ')}</span>
                  <span className="vdc-value">{String(v)}</span>
                </div>
              )) : <p style={{ padding: '10px 12px', fontSize: 12, color: '#8696a0' }}>No booth information available.</p>}
            </div>
          </div>
        )
      }
      case 'referral_link':
        return (
          <div className="referral-card info-card">
            <div className="info-card-header"><i className="bi bi-link-45deg" /> Your Referral Link</div>
            <div className="referral-link-box">{msg.link || 'No link available'}</div>
            {msg.link && (
              <button className="btn-copy" onClick={() => {
                navigator.clipboard?.writeText(msg.link).catch(() => {})
                botSay('✅ Referral link copied!', 100)
              }}>
                <i className="bi bi-clipboard" /> Copy Link
              </button>
            )}
          </div>
        )
      case 'members_list': {
        const members = msg.members || []
        return (
          <div className="members-card info-card">
            <div className="info-card-header"><i className="bi bi-people-fill" /> My Members ({members.length})</div>
            {members.length === 0 ? (
              <p className="members-empty">No members yet. Share your referral link!</p>
            ) : (
              <ul className="members-list">
                {members.slice(0, 15).map((m, i) => (
                  <li key={i}>
                    <span>{m.name || m.Name || m.voter_name || 'Member'}</span>
                    <span style={{ opacity: 0.6, fontSize: 11 }}>{m.epic_no || m.EpicNo || ''}</span>
                  </li>
                ))}
                {members.length > 15 && <li style={{ opacity: 0.5, fontStyle: 'italic' }}>+{members.length - 15} more…</li>}
              </ul>
            )}
          </div>
        )
      }
      default:
        return <span>{msg.text || ''}</span>
    }
  }

  // ── Input area render ─────────────────────────────────────
  const inputCfg = getInputCfg()
  const isWide   = ['voter_card', 'generated_card', 'booth_info', 'referral_link', 'members_list', 'profile_card'].includes
  const isDone   = chatState === S.DONE

  return (
    <div className="chatbot-app wtl-theme">
      {/* ── Main Layout ── */}
      <div className="main-content-layout single-layout">
        
        {/* Left Menu Panel (WhatsApp style) */}
        <div className="left-menu-panel">
          <div className="left-menu-header">
            <div className="left-menu-profile">
              <img src="/newfavicon.png" alt="WTL" onError={(e) => { e.target.style.display = 'none' }} />
              <div className="left-menu-profile-info">
                <div className="left-menu-brand">WE THE LEADERS</div>
                <div className="left-menu-status">
                  <span className="status-dot-green" /> Console online
                </div>
              </div>
            </div>
            <div className="left-menu-header-actions">
              <button
                className="chat-header-btn"
                onClick={() => {
                  if (window.confirm('Logout and start over?')) handleLogout()
                }}
                title="Logout"
                style={{ fontSize: 16 }}
              >
                <i className="bi bi-box-arrow-right" />
              </button>
            </div>
          </div>



          <div className="left-chat-list">
            <div className="left-chat-item active">
              <div className="left-chat-avatar bot-avatar">
                <i className="bi bi-robot" />
              </div>
              <div className="left-chat-details">
                <div className="left-chat-name-row">
                  <span className="left-chat-name">WTL Onboarding Bot</span>
                  <span className="left-chat-time">{fmtTime(new Date())}</span>
                </div>
                <div className="left-chat-msg">
                  {!isDone ? 'Register to generate your Member Card' : 'Registration completed successfully!'}
                </div>
              </div>
            </div>

            {[
              { icon: 'person-circle',       label: 'My Profile',       action: 'profile',     desc: 'View registration details' },
              { icon: 'credit-card-2-front', label: 'My Card',          action: 'my_card',      desc: 'View and download ID card' },
              { icon: 'building',            label: 'Booth Info',        action: 'booth_info',   desc: 'Get your booth details' },
              { icon: 'link-45deg',          label: 'Referral Link',     action: 'referral',     desc: 'Share and invite others' },
              { icon: 'people-fill',         label: 'My Members',        action: 'my_members',   desc: 'Voters registered via your link' },
              { icon: 'hand-thumbs-up-fill', label: 'Be a Volunteer',    action: 'volunteer',    desc: 'Apply to be a WTL Volunteer' },
              { icon: 'building-fill-check', label: 'Be a Booth Agent',  action: 'booth_agent',  desc: 'Apply to be a Booth Agent' },
            ].map((item) => {
              const locked = !isDone
              return (
                <div
                  key={item.action}
                  className={`left-chat-item option-item ${locked ? 'locked' : ''}`}
                  onClick={() => !locked && handleSidebarAction(item.action)}
                  title={locked ? 'Complete registration to unlock' : item.desc}
                >
                  <div className="left-chat-avatar option-avatar">
                    <i className={`bi bi-${item.icon}`} />
                  </div>
                  <div className="left-chat-details">
                    <div className="left-chat-name-row">
                      <span className="left-chat-name">{item.label}</span>
                      {locked && <i className="bi bi-lock-fill lock-icon" />}
                    </div>
                    <div className="left-chat-msg">{item.desc}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Chatbot Panel */}
        <div className="right-chat-panel">
          <div className="chatbot-container">


            {/* Header */}
            <header className="chat-header">
              <div
                className="chat-header-avatar"
                onClick={() => isDone && setSidebarOpen(true)}
              >
                <img src="/newfavicon.png" alt="WTL" onError={(e) => { e.target.style.display = 'none' }} />
              </div>
              <div className="chat-header-info">
                <div className="chat-header-name">WE THE LEADERS</div>
                <div className="chat-header-status">
                  {chatState === S.GENERATING ? (
                    <><span className="status-dot-pulsing" /> Generating membership card...</>
                  ) : isDone ? (
                    <><span className="status-dot-green" /> Console online</>
                  ) : (
                    <><span className="status-dot-green" /> Registration in progress</>
                  )}
                </div>
              </div>
              <div className="chat-header-actions">
                {isDone && (
                  <button
                    className="chat-header-btn"
                    onClick={() => setSidebarOpen(true)}
                    title="Menu"
                  >
                    <i className="bi bi-list" />
                  </button>
                )}
                <button
                  className="chat-header-btn"
                  onClick={() => {
                    if (window.confirm('Logout and start over?')) handleLogout()
                  }}
                  title="Logout"
                >
                  <i className="bi bi-box-arrow-right" />
                </button>
              </div>
            </header>

            {/* Messages */}
            <main className="chat-messages">
              {messages.map((msg) => {
                const isLatest = messages[messages.length - 1]?.id === msg.id
                const isPhotoRequest = isLatest && chatState === S.AWAIT_PHOTO && msg.from === 'bot' && msg.type === 'text'

                if (isPhotoRequest) {
                  const safeHtml = String(msg.text || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
                  return (
                    <div key={msg.id} className="msg-row bot">
                      <div className="msg-bubble msg-bubble-interactive">
                        <div className="interactive-body">
                          <span dangerouslySetInnerHTML={{ __html: safeHtml }} />
                          <div className="msg-time" style={{ marginTop: 8 }}>
                            {fmtTime(msg.ts)}
                          </div>
                        </div>
                        <div className="interactive-buttons">
                          <button className="interactive-btn" onClick={() => fileInputRef.current?.click()}>
                            <i className="bi bi-cloud-upload-fill" /> Upload Image
                          </button>
                          <button className="interactive-btn" onClick={() => cameraInputRef.current?.click()}>
                            <i className="bi bi-camera-fill" /> Take Photo
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div
                    key={msg.id}
                    className={`msg-row ${msg.from}`}
                  >
                    <div className={`msg-bubble ${['voter_card','generated_card','booth_info','referral_link','members_list','profile_card'].includes(msg.type) ? 'wide' : ''}`}>
                      {renderMsgContent(msg)}
                      <div className="msg-time">
                        {fmtTime(msg.ts)}
                      </div>
                    </div>
                  </div>
                )
              })}

              {isTyping && (
                <div className="msg-row bot">
                  <div className="typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} style={{ height: 8 }} />
            </main>

            {/* Input area */}
            <footer className="chat-input-area">
              {chatState === S.CONFIRM ? (
                null
              ) : chatState === S.AWAIT_PHOTO ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => { handleFileSelect(e.target.files?.[0]); e.target.value = '' }}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    style={{ display: 'none' }}
                    onChange={(e) => { handleFileSelect(e.target.files?.[0]); e.target.value = '' }}
                  />
                </>
              ) : chatState === S.GENERATING ? (
                <div className="generating-bar">
                  <div className="spinner-border spinner-border-sm text-success" role="status" />
                  <span>Generating your card, please wait...</span>
                </div>
              ) : isDone && !inputCfg ? (
                <div className="chat-form done-bar">
                  <div className="chat-input-wrapper">
                    <span className="done-status">
                      <i className="bi bi-shield-fill-check text-success" />
                      Card Generated Successfully
                    </span>
                  </div>
                  <button className="chat-send-btn menu-btn" onClick={() => setSidebarOpen(true)} title="Menu">
                    <i className="bi bi-grid-3x3-gap-fill" />
                  </button>
                </div>
              ) : inputCfg ? (
                <form className="chat-form" onSubmit={handleSubmit}>
                  <div className="chat-input-wrapper">
                    <input
                      className="chat-input"
                      value={inputValue}
                      onChange={handleInputChange}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                      placeholder={inputCfg.placeholder}
                      type={inputCfg.type}
                      maxLength={inputCfg.maxLength}
                      inputMode={inputCfg.inputMode}
                      autoComplete="off"
                      disabled={isTyping}
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    className="chat-send-btn"
                    disabled={!inputValue.trim() || isTyping}
                  >
                    <i className="bi bi-send-fill" />
                  </button>
                </form>
              ) : null}
            </footer>
          </div>
        </div>
      </div>

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-header">
              <img src="/newlogo.png" alt="WTL" className="sidebar-logo"
                onError={(e) => { e.target.src = '/newfavicon.png' }} />
              <div>
                <div className="sidebar-brand">WE THE LEADERS</div>
                <div className="sidebar-tagline">Lead the Change</div>
              </div>
            </div>
            <nav className="sidebar-nav">
              {[
                { icon: 'person-circle',       label: 'My Profile',       action: 'profile' },
                { icon: 'credit-card-2-front', label: 'My Card',          action: 'my_card' },
                { icon: 'building',            label: 'Booth Info',        action: 'booth_info' },
                { icon: 'link-45deg',          label: 'Referral Link',     action: 'referral' },
                { icon: 'people-fill',         label: 'My Members',        action: 'my_members' },
                { icon: 'hand-thumbs-up-fill', label: 'Be a Volunteer',    action: 'volunteer' },
                { icon: 'building-fill-check', label: 'Be a Booth Agent',  action: 'booth_agent' },
              ].map((item) => (
                <button
                  key={item.action}
                  className="sidebar-nav-item"
                  onClick={() => handleSidebarAction(item.action)}
                >
                  <i className={`bi bi-${item.icon}`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="sidebar-footer">
              <button className="sidebar-logout-btn" onClick={handleLogout}>
                <i className="bi bi-box-arrow-left" /> Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Crop Modal */}
      {cropOpen && cropSrc && (
        <CropModal
          src={cropSrc}
          onCrop={handleCropComplete}
          onCancel={() => { setCropOpen(false); setCropSrc('') }}
        />
      )}
    </div>
  )
}
