import axios from 'axios'

const api = axios.create({
  // Support VITE_API_URL env var for pointing at staging/production API.
  // Falls back to same-origin (empty string) when not set — works when
  // frontend and backend are co-served.
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
  timeout: 30000,
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response) {
      return Promise.reject(error.response.data || { message: 'Server error' })
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject({ message: 'Request timed out. Please try again.' })
    }
    return Promise.reject({ message: 'Network error. Please check your connection.' })
  }
)

export const chat = {
  sendOtp: (mobile) =>
    api.post('/api/send-otp', { mobile }),

  verifyOtp: (mobile, otp) =>
    api.post('/api/verify-otp', { mobile, otp }),

  checkMobile: (mobile) =>
    api.post('/api/check-mobile', { mobile }),

  verifyPin: (mobile, pin) =>
    api.post('/api/verify-pin', { mobile, pin }),

  forgotPin: (mobile) =>
    api.post('/api/forgot-pin', { mobile }),

  verifyForgotOtp: (mobile, otp) =>
    api.post('/api/verify-forgot-otp', { mobile, otp }),

  resetPin: (mobile, otp, newPin) =>
    api.post('/api/reset-pin', { mobile, otp, new_pin: newPin }),

  setPin: (mobile, pin, epicNo) =>
    api.post('/api/set-pin', { mobile, pin, epic_no: epicNo }),

  validateEpic: (epicNo, mobile) =>
    api.post('/api/validate-epic', { epic_no: epicNo, mobile }),

  generateCard: (formData) =>
    api.post('/api/generate-card', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    }),

  profile: (epicNo, mobile) =>
    api.get(`/api/profile/${epicNo}`, { params: { mobile } }),

  getBooth: (epicNo) =>
    api.get(`/api/booth/${epicNo}`),

  getReferralLink: (wtlCode) =>
    api.get(`/api/referral-link/${wtlCode}`),

  getMyMembers: (wtlCode) =>
    api.get(`/api/my-members/${wtlCode}`),

  requestVolunteer: (wtlCode, epicNo) =>
    api.post('/api/request-volunteer', { wtl_code: wtlCode, epic_no: epicNo }),

  requestBoothAgent: (wtlCode, epicNo, boothNo) =>
    api.post('/api/request-booth-agent', {
      wtl_code: wtlCode,
      epic_no: epicNo,
      booth_no: boothNo,
    }),
}

export const admin = {
  login: (username, password) =>
    api.post('/admin/api/login', { username, password }),

  logout: () =>
    api.post('/admin/api/logout'),

  // Lightweight session check — use instead of getStats() for auth probe
  getSession: () =>
    api.get('/admin/api/session'),

  getStats: () =>
    api.get('/admin/api/stats'),

  getExternalStats: () =>
    api.get('/admin/api/external-stats'),

  getVoters: (params) =>
    api.get('/admin/api/voters', { params }),

  getVoterDetail: (epicNo) =>
    api.get(`/admin/api/voters/${epicNo}`),

  getGeneratedVoters: (params) =>
    api.get('/admin/api/generated-voters', { params }),

  getGeneratedVoterDetail: (wtlCode) =>
    api.get(`/admin/api/generated-voters/${wtlCode}`),

  getVolunteerRequests: (params) =>
    api.get('/admin/api/volunteer-requests', { params }),

  confirmVolunteer: (wtlCode) =>
    api.post(`/admin/api/volunteer-requests/${wtlCode}/confirm`),

  rejectVolunteer: (wtlCode) =>
    api.post(`/admin/api/volunteer-requests/${wtlCode}/reject`),

  getConfirmedVolunteers: (params) =>
    api.get('/admin/api/confirmed-volunteers', { params }),

  getBoothAgentRequests: (params) =>
    api.get('/admin/api/booth-agent-requests', { params }),

  confirmBoothAgent: (wtlCode) =>
    api.post(`/admin/api/booth-agent-requests/${wtlCode}/confirm`),

  rejectBoothAgent: (wtlCode) =>
    api.post(`/admin/api/booth-agent-requests/${wtlCode}/reject`),

  getConfirmedBoothAgents: (params) =>
    api.get('/admin/api/confirmed-booth-agents', { params }),
}

export const publicApi = {
  verifyVoter: (epicNo) =>
    api.get(`/api/verify/${epicNo}`),

  getCardData: (epicNo) =>
    api.get(`/api/card/${epicNo}`),
}
