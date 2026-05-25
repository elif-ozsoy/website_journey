import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Task, Agent, Session } from '../lib/types'
import { DEFAULT_AGENTS } from '../lib/types'
import * as api from '../lib/api'

interface ProjectContextValue {
  siteId: string
  testerLink: string
  siteUrl: string
  label: string
  tasks: Task[]
  agents: Agent[]
  sessions: Session[]
  journeys: api.JourneyResponse[]
  setTasks: (tasks: Task[]) => void
  setAgents: (agents: Agent[]) => void
  refreshTasks: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshJourneys: () => Promise<void>
  loading: boolean
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({
  siteId, testerLink, siteUrl, label, children,
}: {
  siteId: string
  testerLink: string
  siteUrl: string
  label: string
  children: ReactNode
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS)
  const [sessions, setSessions] = useState<Session[]>([])
  const [journeys, setJourneys] = useState<api.JourneyResponse[]>([])
  const [loading, setLoading] = useState(true)

  const refreshTasks = useCallback(async () => {
    try { setTasks(await api.listTasks(siteId)) } catch { /* keep existing */ }
  }, [siteId])

  const refreshSessions = useCallback(async () => {
    try {
      const raw = await api.listSessions(siteId)
      // Backend returns snake_case; normalize to camelCase to match the Session type
      const normalized = raw.map((s: any) => ({
        ...s,
        siteId: s.site_id ?? s.siteId,
        startedAt: s.started_at ?? s.startedAt,
        userAgent: s.user_agent ?? s.userAgent,
        viewportW: s.viewport_w ?? s.viewportW,
        viewportH: s.viewport_h ?? s.viewportH,
        deviceType: s.device_type ?? s.deviceType,
      }))
      setSessions(normalized)
    } catch { /* keep existing */ }
  }, [siteId])

  const refreshJourneys = useCallback(async () => {
    try { setJourneys(await api.listSiteJourneys(siteId)) } catch { /* keep existing */ }
  }, [siteId])

  useEffect(() => {
    setLoading(true)
    Promise.all([refreshTasks(), refreshSessions(), refreshJourneys()]).finally(() => setLoading(false))
  }, [refreshTasks, refreshSessions, refreshJourneys])

  return (
    <ProjectContext.Provider value={{
      siteId, testerLink, siteUrl, label,
      tasks, agents, sessions, journeys,
      setTasks, setAgents,
      refreshTasks, refreshSessions, refreshJourneys,
      loading,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProjectContext must be used inside ProjectProvider')
  return ctx
}
