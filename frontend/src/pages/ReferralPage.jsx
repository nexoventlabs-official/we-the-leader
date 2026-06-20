import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function ReferralPage() {
  const { wtlCode, referralId } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (wtlCode && referralId) {
      const cleanWtl = wtlCode.trim().toUpperCase()
      const cleanRid = referralId.trim().toUpperCase()
      try {
        localStorage.setItem('wtl_referral', JSON.stringify({
          wtlCode: cleanWtl,
          referralId: cleanRid,
          timestamp: Date.now(),
        }))
      } catch {}
      navigate(`/?ref=${cleanWtl}&rid=${cleanRid}`, { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }, [wtlCode, referralId, navigate])

  return null
}
