import { useState, useEffect } from 'react'
import { Outlet, useParams, Navigate } from 'react-router-dom'
import { ProjectProvider } from '../context/ProjectContext'
import * as api from '../lib/api'

export default function ProjectShell() {
  const { siteId } = useParams<{ siteId: string }>()
  const [site, setSite] = useState<api.SiteDetail | null | 'loading'>('loading')

  useEffect(() => {
    if (!siteId) { setSite(null); return }
    api.getSite(siteId)
      .then(setSite)
      .catch(() => setSite(null))
  }, [siteId])

  if (site === 'loading') return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <span style={{ width: 24, height: 24, border: '2.5px solid var(--gray200)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
    </div>
  )
  if (!siteId || !site) return <Navigate to="/projects" replace />

  return (
    <ProjectProvider
      siteId={siteId}
      testerLink={site.tester_link}
      siteUrl={site.target_url}
      label={site.label ?? ''}
    >
      <Outlet />
    </ProjectProvider>
  )
}
