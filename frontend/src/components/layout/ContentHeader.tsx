import { useMatch, useNavigate, useSearchParams, Link } from 'react-router-dom'
import type { Project } from '../../lib/types'
import { PROJECTS_STORAGE_KEY } from '../../lib/types'
import { getVersions } from '../../pages/EvaluationPage'

const VIEW_LABELS: Record<string, string> = {
  overview: 'Overview',
  aggregate: 'Aggregate Journeys',
  heatmap: 'Heatmap',
  details: 'Trajectories',
  human_vs_ai: 'Human vs AI',
}

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3L5 8l5 5"/>
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2l4 3-4 3"/>
    </svg>
  )
}

// Version selector — only rendered on dashboard pages
function VersionSelector({ siteId, testerLink }: { siteId: string; testerLink: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const versions = getVersions(siteId, testerLink)
  const selectedVersion = searchParams.get('version') ?? versions[versions.length - 1]?.id ?? 'v1'

  function setVersion(v: string) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('version', v)
      return p
    }, { replace: true })
  }

  if (versions.length <= 1) return null

  return (
    <select
      className="content-header-version-select"
      value={selectedVersion}
      onChange={e => setVersion(e.target.value)}
    >
      {[...versions].reverse().map(v => (
        <option key={v.id} value={v.id}>{v.label}</option>
      ))}
    </select>
  )
}

export default function ContentHeader() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const onProjects = useMatch('/projects')
  const onNewProject = useMatch('/projects/new')
  const projectMatch = useMatch('/projects/:siteId/*')
  const onProjectOverview = useMatch('/projects/:siteId')
  const onDashboard = useMatch('/projects/:siteId/dashboard')
  const onAgentRun = useMatch('/projects/:siteId/agent-run')

  const siteId = projectMatch?.params.siteId
  const allProjects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const project = siteId ? allProjects.find(p => p.siteId === siteId) : null
  const hostname = project?.url ? (() => { try { return new URL(project.url).hostname } catch { return '' } })() : ''
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : null

  const currentView = searchParams.get('view') ?? 'overview'
  const viewLabel = VIEW_LABELS[currentView] ?? 'Overview'

  // Determine back destination and label
  let backTo: string | null = null
  let backLabel = ''

  if (onProjects || onNewProject) {
    // No back on home
  } else if (onProjectOverview) {
    backTo = '/projects'
    backLabel = 'Home'
  } else if (onDashboard) {
    backTo = siteId ? `/projects/${siteId}` : '/projects'
    backLabel = 'Project Overview'
  } else if (onAgentRun) {
    backTo = siteId ? `/projects/${siteId}` : '/projects'
    backLabel = 'Project Overview'
  } else if (siteId) {
    backTo = `/projects/${siteId}/dashboard`
    backLabel = 'Dashboard'
  }

  // Read testerLink from project data for version selector
  const testerLink = project?.testerLink ?? ''

  return (
    <div className="content-header">
      {/* Back button */}
      {backTo && (
        <button
          className="content-header-back"
          onClick={() => navigate(backTo!)}
          title={`Back to ${backLabel}`}
        >
          <BackArrow />
        </button>
      )}

      {/* Breadcrumb */}
      <nav className="content-header-breadcrumb">
        <Link to="/projects" className="content-header-crumb root">Home</Link>

        {siteId && project && (
          <>
            <span className="content-header-sep"><ChevronRight /></span>
            <Link to={`/projects/${siteId}`} className="content-header-crumb">
              <div className="content-header-crumb-inner">
                {faviconUrl && (
                  <img src={faviconUrl} alt="" width={13} height={13}
                    style={{ borderRadius: 2, flexShrink: 0 }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {project.label}
                {hostname && <span className="content-header-hostname">{hostname}</span>}
              </div>
            </Link>
          </>
        )}

        {onDashboard && (
          <>
            <span className="content-header-sep"><ChevronRight /></span>
            <span className="content-header-crumb leaf">{viewLabel}</span>
          </>
        )}

        {onAgentRun && (
          <>
            <span className="content-header-sep"><ChevronRight /></span>
            <span className="content-header-crumb leaf">Agent Run</span>
          </>
        )}

        {onNewProject && (
          <>
            <span className="content-header-sep"><ChevronRight /></span>
            <span className="content-header-crumb leaf">New Project</span>
          </>
        )}
      </nav>

      {/* Version selector — only on dashboard */}
      {onDashboard && siteId && (
        <div style={{ marginLeft: 'auto' }}>
          <VersionSelector siteId={siteId} testerLink={testerLink} />
        </div>
      )}
    </div>
  )
}

