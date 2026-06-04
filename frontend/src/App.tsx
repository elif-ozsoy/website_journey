import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
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

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 32, background: 'var(--bg)' }}>
          <div style={{ fontSize: 'var(--fs-headline)', fontWeight: 700, color: 'var(--text-primary)' }}>Something went wrong</div>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', maxWidth: 480, textAlign: 'center' }}>
            {(this.state.error as Error).message}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
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
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
                  <Routes>
                    <Route path="/projects" element={<MyProjectsPage />} />
                    <Route path="/projects/new" element={<NewProjectPage />} />
                    <Route path="/projects/:siteId" element={<ProjectShell />}>
                      <Route index element={<ErrorBoundary><EvaluationPage /></ErrorBoundary>} />
                      <Route path="agent-run" element={<ErrorBoundary><AgentRunPage /></ErrorBoundary>} />
                      <Route path="dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
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
