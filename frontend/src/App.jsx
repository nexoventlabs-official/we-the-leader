import { Routes, Route, Navigate } from 'react-router-dom'
import ChatbotPage from './pages/ChatbotPage'
import CardPage from './pages/CardPage'
import VerifyPage from './pages/VerifyPage'
import ReferralPage from './pages/ReferralPage'
import AdminLayout from './pages/admin/AdminLayout'
import LoginPage from './pages/admin/LoginPage'
import DashboardPage from './pages/admin/DashboardPage'
import VotersPage from './pages/admin/VotersPage'
import VoterDetailPage from './pages/admin/VoterDetailPage'
import GeneratedVotersPage from './pages/admin/GeneratedVotersPage'
import GeneratedVoterDetailPage from './pages/admin/GeneratedVoterDetailPage'
import VolunteerRequestsPage from './pages/admin/VolunteerRequestsPage'
import ConfirmedVolunteersPage from './pages/admin/ConfirmedVolunteersPage'
import BoothAgentRequestsPage from './pages/admin/BoothAgentRequestsPage'
import ConfirmedBoothAgentsPage from './pages/admin/ConfirmedBoothAgentsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatbotPage />} />
      <Route path="/card/:epicNo" element={<CardPage />} />
      <Route path="/verify/:epicNo" element={<VerifyPage />} />
      <Route path="/refer/:wtlCode/:referralId" element={<ReferralPage />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="voters" element={<VotersPage />} />
        <Route path="voters/:epicNo" element={<VoterDetailPage />} />
        <Route path="generated-voters" element={<GeneratedVotersPage />} />
        <Route path="generated-voters/:wtlCode" element={<GeneratedVoterDetailPage />} />
        <Route path="volunteer-requests" element={<VolunteerRequestsPage />} />
        <Route path="confirmed-volunteers" element={<ConfirmedVolunteersPage />} />
        <Route path="booth-agent-requests" element={<BoothAgentRequestsPage />} />
        <Route path="confirmed-booth-agents" element={<ConfirmedBoothAgentsPage />} />
      </Route>
    </Routes>
  )
}
