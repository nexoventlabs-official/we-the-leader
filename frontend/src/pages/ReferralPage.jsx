import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function ReferralPage() {
  const { wtlCode, referralId } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (wtlCode && referralId) {
      try {
        localStorage.setItem('wtl_referral', JSON.stringify({
          wtlCode,
          referralId,
          timestamp: Date.now(),
        }))
      } catch {}
    }
    navigate('/', { replace: true })
  }, [wtlCode, referralId, navigate])

  return null
}
