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

  if (site === 'loading') return null
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
