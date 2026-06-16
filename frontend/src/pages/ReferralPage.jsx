import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function ReferralPage() {
  const { ptcCode, referralId } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (ptcCode && referralId) {
      try {
        localStorage.setItem('wtl_referral', JSON.stringify({
          ptcCode,
          referralId,
          timestamp: Date.now(),
        }))
      } catch {}
    }
    navigate('/', { replace: true })
  }, [ptcCode, referralId, navigate])

  return null
}
