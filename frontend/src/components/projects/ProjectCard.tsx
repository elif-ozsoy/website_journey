import { useNavigate } from 'react-router-dom'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
  onDelete?: (siteId: string) => void
}

export default function ProjectCard({ project, onDelete }: Props) {
  const navigate = useNavigate()
  const hostname = (() => { try { return new URL(project.url).hostname } catch { return project.url } })()
  const age = (() => {
    const diff = Date.now() - new Date(project.createdAt).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return '1 day ago'
    if (days < 7) return `${days} days ago`
    return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`
  })()

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`

  return (
    <div className="proj-card card-hover" onClick={() => {
      const hasDashboard = Object.keys(localStorage).some(k => k.startsWith(`ciphercorgi_comparative_${project.siteId}_`))
      navigate(hasDashboard ? `/projects/${project.siteId}/dashboard` : `/projects/${project.siteId}`)
    }}>
      <div className="proj-card-logo">
        <img
          src={faviconUrl}
          alt=""
          width={24}
          height={24}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'block' }}
        />
        <span style={{ display: 'none', fontSize: 'var(--fs-headline)' }}>🌐</span>
      </div>
      <h3>{project.label}</h3>
      <div className="url">{hostname}</div>
      <div className="meta">
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>{age}</span>
        {onDelete && (
          <button
            className="btn btn-ghost btn-xs"
            style={{ marginLeft: 'auto', color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}
            onClick={e => { e.stopPropagation(); onDelete(project.siteId) }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}
