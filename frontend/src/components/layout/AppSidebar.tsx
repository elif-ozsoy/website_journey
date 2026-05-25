import { useState, useRef, useEffect } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { getUser, clearUser } from '../../pages/LoginPage'
import type { Project } from '../../lib/types'
import { PROJECTS_STORAGE_KEY } from '../../lib/types'
import { useAgentRun } from '../../context/AgentRunContext'
import { ANTHROPIC_KEY_STORAGE } from '../../lib/api'

// ─── API Key Modal ─────────────────────────────────────────────────────────────

function ApiKeyModal({ onClose }: { onClose: () => void }) {
  const { apiKey, setApiKey, provider, setProvider } = useAgentRun()
  const [draft, setDraft] = useState(apiKey)
  const [draftProvider, setDraftProvider] = useState(provider)
  const [draftAnthropicKey, setDraftAnthropicKey] = useState(
    () => localStorage.getItem(ANTHROPIC_KEY_STORAGE) ?? ''
  )

  function handleSave() {
    setApiKey(draft)
    setProvider(draftProvider as 'nvidia' | 'google')
    if (draftAnthropicKey.trim()) {
      localStorage.setItem(ANTHROPIC_KEY_STORAGE, draftAnthropicKey.trim())
    } else {
      localStorage.removeItem(ANTHROPIC_KEY_STORAGE)
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">API Key Settings</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--gray700)', display: 'block', marginBottom: 6 }}>Agent Provider</label>
            <select value={draftProvider} onChange={e => setDraftProvider(e.target.value as 'nvidia' | 'google')} className="input" style={{ width: '100%' }}>
              <option value="nvidia">NVIDIA (free)</option>
              <option value="google">Google Gemini</option>
            </select>
            <p style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 5 }}>
              {draftProvider === 'nvidia' ? 'Get a free key at build.nvidia.com → sign up → API Keys.' : 'Get a key at aistudio.google.com → Get API key.'}
            </p>
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--gray700)', display: 'block', marginBottom: 6 }}>Agent API Key</label>
            <input type="password" placeholder={draftProvider === 'nvidia' ? 'nvapi-…' : 'AIza…'} value={draft} onChange={e => setDraft(e.target.value)} className="input" style={{ fontFamily: 'var(--font-sans)', width: '100%' }} autoComplete="off" />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <label style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--gray700)', display: 'block', marginBottom: 6 }}>Anthropic API Key</label>
            <input type="password" placeholder="sk-ant-…" value={draftAnthropicKey} onChange={e => setDraftAnthropicKey(e.target.value)} className="input" style={{ fontFamily: 'var(--font-sans)', width: '100%' }} autoComplete="off" />
            <p style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 5 }}>Used for comparative analysis. Saved locally in your browser only.</p>
          </div>
        </div>
        <div style={{ padding: '0 28px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IcoHome() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6.5L8 2l6 4.5V14a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z"/><path d="M6 15V9h4v6"/></svg>
}

function IcoProjects() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>
}

function IcoOverview() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>
}

function IcoDashboard() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="14" height="5" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>
}

function IcoSankey() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h3"/><path d="M1 13h3"/><path d="M4 3 Q10 3 13 8"/><path d="M4 13 Q10 13 13 8"/><line x1="13" y1="5" x2="13" y2="11"/></svg>
}

function IcoHeatmap() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="3.5" strokeOpacity="0.35"/><circle cx="5" cy="5" r="1.8" strokeOpacity="0.65"/><circle cx="5" cy="5" r="0.6" fill="currentColor" stroke="none"/><circle cx="11" cy="11" r="2.5" strokeOpacity="0.35"/><circle cx="11" cy="11" r="1.2" strokeOpacity="0.65"/><circle cx="11" cy="11" r="0.6" fill="currentColor" stroke="none"/></svg>
}


function IcoHorizonGraph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="14" height="4" rx="1" strokeOpacity="0.4" />
      <path d="M1 5 Q4 3.5 6 5 Q8 6.5 10 5 Q12 3.5 15 4" />
      <rect x="1" y="9" width="14" height="4" rx="1" strokeOpacity="0.4" />
      <path d="M1 11 Q3 9.5 5 11 Q7 12.5 9 11 Q11 9.5 13 10 Q14 10.3 15 10" />
    </svg>
  )
}

function IcoHumanVsAI() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="4" r="2"/><path d="M1 12.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5"/><circle cx="13" cy="4" r="2"/><path d="M10 12.5c0-2.2.8-3.5 3-3.5" strokeDasharray="2 1.5"/></svg>
}

function IcoAgentRun() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polygon points="4,2 14,8 4,14"/></svg>
}

function IcoSettings() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.36 3.64l-1.06 1.06M4.7 11.3l-1.06 1.06M12.36 12.36l-1.06-1.06M4.7 4.7L3.64 3.64"/></svg>
}

function IcoLogout() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3"/><path d="M11 11l3-3-3-3"/><line x1="14" y1="8" x2="6" y2="8"/></svg>
}

function IcoChevron() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2l4 4-4 4"/></svg>
}

function IcoFlow() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3" cy="4" r="1.3"/>
    <circle cx="3" cy="12" r="1.3"/>
    <circle cx="13" cy="8" r="1.3"/>
    <path d="M4.2 4.3 Q9 5 11.8 7.4"/>
    <path d="M4.2 11.7 Q9 11 11.8 8.6"/>
  </svg>
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  icon, label, active, sub, expanded, onClick, to,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  sub?: boolean
  expanded: boolean
  onClick?: () => void
  to?: string
}) {
  const navigate = useNavigate()
  const handleClick = () => {
    if (to) navigate(to)
    if (onClick) onClick()
  }

  return (
    <button
      onClick={handleClick}
      className={clsx('sidebar-nav-item', active && 'active', sub && 'sub')}
      title={!expanded ? label : undefined}
    >
      <span className="sidebar-nav-icon">{icon}</span>
      {expanded && <span className="sidebar-nav-label">{label}</span>}
    </button>
  )
}

// ─── AppSidebar ───────────────────────────────────────────────────────────────

export default function AppSidebar() {
  const [expanded, setExpanded] = useState(false)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const navigate = useNavigate()

  const onProjects = useMatch('/projects')
  const projectMatch = useMatch('/projects/:siteId/*')
  const dashboardMatch = useMatch('/projects/:siteId/dashboard')
  const agentRunMatch = useMatch('/projects/:siteId/agent-run')

  const siteId = projectMatch?.params.siteId
  const allProjects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const project = siteId ? allProjects.find(p => p.siteId === siteId) : null
  const hostname = project?.url ? (() => { try { return new URL(project.url).hostname } catch { return '' } })() : ''
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : null

  const { runState, progress, statusMsg, liveStepCount } = useAgentRun()
  const isRunning = runState === 'running' || runState === 'error'

  const user = getUser()
  const initials = user ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'UX'

  // Current dashboard view from URL
  const searchParams = new URLSearchParams(window.location.search)
  const currentView = searchParams.get('view') ?? ''

  useEffect(() => {
    function out(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [])

  // Close on route change
  useEffect(() => {
    setExpanded(false)
  }, [siteId, dashboardMatch, agentRunMatch])

  function handleSignOut() {
    setUserOpen(false)
    clearUser()
    navigate('/')
  }

  const isOnProject = !!siteId
  const isOnDashboard = !!dashboardMatch

  const evaluationViews = [
    { view: 'overview', label: 'Action Points', icon: <IcoOverview /> },
  ]

  const analysisViews = [
    { view: 'aggregate', label: 'Aggregate Journeys', icon: <IcoSankey /> },
    { view: 'heatmap', label: 'Heatmap', icon: <IcoHeatmap /> },
    { view: 'human_vs_ai', label: 'Human vs AI', icon: <IcoHumanVsAI /> },
    { view: 'horizon_graph', label: 'Horizon Graph', icon: <IcoHorizonGraph /> },
    { view: 'flow_sankey', label: 'Flow Diagram', icon: <IcoFlow /> },

  ]

  return (
    <>
      <aside
        ref={sidebarRef}
        className={clsx('app-sidebar', expanded && 'expanded')}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {/* Logo */}
        <div className="sidebar-logo" onClick={() => navigate('/projects')} title="CipherCorgi">
          <span className="sidebar-logo-icon">🐾</span>
          {expanded && <span className="sidebar-logo-text">CipherCorgi</span>}
        </div>

        <div className="sidebar-divider" />

        {/* Global nav */}
        <div className="sidebar-section">
          <NavItem icon={<IcoHome />} label="Home" active={!!onProjects && !siteId} expanded={expanded} to="/projects" />
        </div>

        {/* Project-specific nav */}
        {isOnProject && (
          <>
            <div className="sidebar-divider" />

            {/* Project identity */}
            {expanded && project && (
              <div className="sidebar-project-identity">
                {faviconUrl && (
                  <img src={faviconUrl} alt="" width={14} height={14}
                    style={{ borderRadius: 3, flexShrink: 0 }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <span className="sidebar-project-name">{project.label}</span>
              </div>
            )}
            {!expanded && project && faviconUrl && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                <img src={faviconUrl} alt="" width={20} height={20}
                  style={{ borderRadius: 4 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              </div>
            )}

            {/* Project Overview */}
            <div className="sidebar-section">
              <NavItem icon={<IcoDashboard />} label="Project Overview" active={!isOnDashboard && !agentRunMatch} expanded={expanded} to={`/projects/${siteId}`} />
            </div>

            <div className="sidebar-divider" />

            {/* Evaluation section */}
            <div className="sidebar-section">
              {expanded && <div className="sidebar-section-label">Evaluation</div>}
              {evaluationViews.map(({ view, label, icon }) => (
                <NavItem
                  key={view}
                  icon={icon}
                  label={label}
                  active={isOnDashboard && (currentView === view || (view === 'overview' && !currentView))}
                  sub
                  expanded={expanded}
                  to={`/projects/${siteId}/dashboard?view=${view}`}
                />
              ))}
            </div>

            <div className="sidebar-divider" />

            {/* Analysis section */}
            <div className="sidebar-section">
              {expanded && <div className="sidebar-section-label">Analysis</div>}
              {analysisViews.map(({ view, label, icon }) => (
                <NavItem
                  key={view}
                  icon={icon}
                  label={label}
                  active={isOnDashboard && currentView === view}
                  sub
                  expanded={expanded}
                  to={`/projects/${siteId}/dashboard?view=${view}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Agent run progress bar */}
        {isRunning && (
          <div style={{ padding: '8px 12px', flexShrink: 0 }}>
            {expanded && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: runState === 'error' ? 'var(--red)' : 'var(--accent)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {runState === 'error' ? 'Run stopped' : statusMsg || 'Agent running…'}
                </div>
                {liveStepCount > 0 && runState !== 'error' && (
                  <div style={{ fontSize: 10, color: 'var(--gray400)', marginBottom: 4 }}>
                    Step {liveStepCount} · {progress}%
                  </div>
                )}
              </>
            )}
            <div style={{ height: 3, borderRadius: 2, background: 'var(--gray100)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: runState === 'error' ? 'var(--red)' : 'var(--accent)', transition: 'width 0.3s ease-out' }} />
            </div>
          </div>
        )}

        <div className="sidebar-divider" />

        {/* User */}
        <div ref={userRef} className="sidebar-user" style={{ position: 'relative' }}>
          <button
            className="sidebar-user-btn"
            onClick={() => setUserOpen(o => !o)}
            title={!expanded ? (user?.name ?? '') : undefined}
          >
            <div className="sidebar-avatar">{initials}</div>
            {expanded && <span className="sidebar-user-name">{user?.name}</span>}
            {expanded && <span style={{ marginLeft: 'auto', opacity: 0.4 }}><IcoChevron /></span>}
          </button>

          {userOpen && (
            <div className={clsx('sidebar-user-menu', expanded ? 'expanded' : 'collapsed')}>
              <div className="sidebar-user-menu-header">
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', color: 'var(--gray900)' }}>{user?.name}</div>
                <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>{user?.email}</div>
              </div>
              <div className="sidebar-divider" style={{ margin: 0 }} />
              <button className="sidebar-user-menu-item" onClick={() => { setUserOpen(false); setApiKeyOpen(true) }}>
                <IcoSettings /> <span>API Key Settings</span>
              </button>
              <button className="sidebar-user-menu-item danger" onClick={handleSignOut}>
                <IcoLogout /> <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {apiKeyOpen && <ApiKeyModal onClose={() => setApiKeyOpen(false)} />}
    </>
  )
}
