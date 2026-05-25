import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppSidebar from './components/layout/AppSidebar'
import { AgentRunProvider } from './context/AgentRunContext'
import MyProjectsPage from './pages/MyProjectsPage'
import NewProjectPage from './pages/NewProjectPage'
import EvaluationPage from './pages/EvaluationPage'
import AgentRunPage from './pages/AgentRunPage'
import DashboardPage from './pages/DashboardPage'
import ProjectShell from './pages/ProjectShell'
import LoginPage, { getUser } from './pages/LoginPage'
import LandingPage from './pages/LandingPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getUser()) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={getUser() ? <Navigate to="/projects" replace /> : <LandingPage />}
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/home" element={<Navigate to="/projects" replace />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AgentRunProvider>
                <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#e8eaf0' }}>
                  <AppSidebar />
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                  <Routes>
                    <Route path="/projects" element={<MyProjectsPage />} />
                    <Route path="/projects/new" element={<NewProjectPage />} />
                    <Route path="/projects/:siteId" element={<ProjectShell />}>
                      <Route index element={<EvaluationPage />} />
                      <Route path="agent-run" element={<AgentRunPage />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                    </Route>
                  </Routes>
                  </div>
                </div>
              </AgentRunProvider>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
