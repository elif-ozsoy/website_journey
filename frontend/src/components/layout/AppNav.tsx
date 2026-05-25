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
            <input
              type="password"
              placeholder={draftProvider === 'nvidia' ? 'nvapi-…' : 'AIza…'}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="input"
              style={{ fontFamily: 'var(--font-sans)', width: '100%' }}
              autoComplete="off"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <label style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--gray700)', display: 'block', marginBottom: 6 }}>Anthropic API Key</label>
            <input
              type="password"
              placeholder="sk-ant-…"
              value={draftAnthropicKey}
              onChange={e => setDraftAnthropicKey(e.target.value)}
              className="input"
              style={{ fontFamily: 'var(--font-sans)', width: '100%' }}
              autoComplete="off"
            />
            <p style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 5 }}>Used for comparative analysis and action point explanations. Saved locally in your browser only.</p>
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

// ─── Breadcrumb dropdown ───────────────────────────────────────────────────────

interface DropdownItem { label: string; to: string }

function BreadcrumbDropdown({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function out(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="app-breadcrumb-item app-breadcrumb-item--leaf active"
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {label}
        <span style={{ fontSize: 'var(--fs-small)', lineHeight: 1, opacity: 0.6, marginTop: 1 }}>{open ? '▲' : '▾'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: 160, overflow: 'hidden', padding: '4px 0',
        }}>
          {items.map(item => (
            <button
              key={item.to}
              onClick={() => { navigate(item.to); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 'var(--fs-body)', fontWeight: item.label === label ? 700 : 500,
                color: item.label === label ? 'var(--brand)' : 'var(--gray700)',
              }}
              className="nav-dropdown-item"
            >
              {item.label === label && <span style={{ marginRight: 6, fontSize: 'var(--fs-small)' }}>✓</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AppNav ────────────────────────────────────────────────────────────────────


export default function AppNav() {
  const onProjects = useMatch('/projects')
  const onHome = useMatch('/home')
  const projectMatch = useMatch('/projects/:siteId/*')
  const dashboardMatch = useMatch('/projects/:siteId/dashboard')
  const navigate = useNavigate()
  const user = getUser()
  const initials = user ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'UX'

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const siteId = projectMatch?.params.siteId
  const allProjects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const projectLabel = siteId ? (allProjects.find(p => p.siteId === siteId)?.label ?? siteId) : null
  const projectItems: DropdownItem[] = allProjects.map(p => ({
    label: p.label,
    to: `/projects/${p.siteId}`,
  }))

  const { runState, progress } = useAgentRun()
  const isActive = runState === 'running' || runState === 'error'

  function handleSignOut() {
    setDropdownOpen(false)
    clearUser()
    navigate('/')
  }

  const isOnDashboard = !!dashboardMatch

  // Level-3 siblings: Project Overview vs Dashboard
  const level3Items: DropdownItem[] = siteId ? [
    { label: 'Project Overview', to: `/projects/${siteId}` },
    { label: 'Dashboard', to: `/projects/${siteId}/dashboard` },
  ] : []
  const level3Label = isOnDashboard ? 'Dashboard' : 'Project Overview'

  return (
    <nav className="app-nav" style={{ position: 'relative' }}>
      <div className="app-nav-left">
        <Link to="/projects" className="app-logo" style={{ textDecoration: 'none' }}>CipherCorgi</Link>

        <div className="app-breadcrumb">
          <Link to="/projects" className={clsx('app-breadcrumb-item app-breadcrumb-item--root', (onProjects || onHome) && !siteId && 'active')}>Home</Link>

          {siteId && (
            <>
              <span className="app-breadcrumb-chevron">›</span>
              <BreadcrumbDropdown label={projectLabel ?? ''} items={projectItems} />
              <span className="app-breadcrumb-chevron">›</span>
              <BreadcrumbDropdown label={level3Label} items={level3Items} />
            </>
          )}
        </div>
      </div>

      {runState === 'error' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 10px 3px 7px', borderRadius: 999, fontSize: 'var(--fs-small)', fontWeight: 700,
          background: 'var(--red-pale)', color: 'var(--red)',
          border: '1px solid var(--red)',
          maxWidth: 220, overflow: 'hidden',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: 'var(--red)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚠ Run stopped</span>
        </div>
      )}

      <div className="app-nav-right">
        <div className="nav-user-dropdown" ref={dropdownRef}>
          <button className="nav-user-trigger" onClick={() => setDropdownOpen(o => !o)}>
            <span className="nav-user-name">{user?.name}</span>
            <div className="nav-avatar">{initials}</div>
          </button>
          {dropdownOpen && (
            <div className="nav-dropdown-menu">
              <div className="nav-dropdown-header">
                <p className="nav-dropdown-name">{user?.name}</p>
                <p className="nav-dropdown-email">{user?.email}</p>
              </div>
              <div className="nav-dropdown-divider" />
              <button className="nav-dropdown-item" onClick={() => { setDropdownOpen(false); setApiKeyOpen(true) }}>
                API Key Settings
              </button>
              <div className="nav-dropdown-divider" />
              <button className="nav-dropdown-item nav-dropdown-item--danger" onClick={handleSignOut}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {apiKeyOpen && <ApiKeyModal onClose={() => setApiKeyOpen(false)} />}

      {isActive && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'var(--gray100)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: runState === 'error' ? 'var(--red)' : 'var(--brand)',
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}
    </nav>
  )
}
