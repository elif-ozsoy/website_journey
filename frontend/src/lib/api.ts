import type { Task, Session, EventRow } from './types'

const BASE = '/api'

export const ANTHROPIC_KEY_STORAGE = 'cc_api_key_anthropic'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('ciphercorgi_token')
  const anthropicKey = localStorage.getItem(ANTHROPIC_KEY_STORAGE)
  const agentKey = localStorage.getItem('ciphercorgi_apikey')
  const agentProvider = localStorage.getItem('ciphercorgi_provider')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(anthropicKey ? { 'X-Anthropic-Key': anthropicKey } : {}),
      ...(agentKey ? { 'X-Agent-Api-Key': agentKey } : {}),
      ...(agentProvider ? { 'X-Agent-Provider': agentProvider } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || path}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  username: string
  email: string | null
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

export function identify(name: string, email: string) {
  return request<AuthResponse>('/v1/auth/identify', {
    method: 'POST',
    body: JSON.stringify({ name, email }),
  })
}

export function register(username: string, password: string, email?: string) {
  return request<AuthResponse>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email: email ?? null }),
  })
}

export function login(username: string, password: string) {
  return request<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function getMe() {
  return request<AuthUser>('/v1/auth/me')
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export interface SiteDetail {
  site_id: string
  slug: string
  tester_link: string
  label: string | null
  target_url: string
}

export function getSite(siteId: string) {
  return request<SiteDetail>(`/v1/sites/${siteId}`)
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function createProject(url: string, label: string) {
  return request<{ tester_link: string; site_id: string }>('/v1/data-collection/tester-link', {
    method: 'POST',
    body: JSON.stringify({ url, label }),
  })
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export function listTasks(siteId: string) {
  return request<Task[]>(`/v1/sites/${siteId}/tasks`)
}

export function createTask(siteId: string, title: string, description?: string) {
  return request<Task>(`/v1/sites/${siteId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title, description: description ?? null }),
  })
}

export function updateTask(taskId: number, title: string, description?: string) {
  return request<Task>(`/v1/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, description: description ?? null }),
  })
}

export function deleteTask(taskId: number) {
  return request<void>(`/v1/tasks/${taskId}`, { method: 'DELETE' })
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function listSessions(siteId: string, limit = 100) {
  return request<Session[]>(`/v1/sites/${siteId}/sessions?limit=${limit}`)
}

export function getSession(sessionId: string) {
  return request<Session>(`/v1/sessions/${sessionId}`)
}

export function listEvents(sessionId: string, limit = 500) {
  return request<EventRow[]>(`/v1/sessions/${sessionId}/events?limit=${limit}`)
}

// ─── Journeys ────────────────────────────────────────────────────────────────

export interface JourneyResponse {
  id: number
  site_id: string
  task_id: number | null
  user_id: string | null
  task_title: string
  total_steps: number
  steps: object[]
  policy_trace?: object[] | null
  llm_analysis: string | null
  source: string
  is_agent: boolean | null
  embedding: number[] | null
  completed_at: string
  updated_at: string
}

export interface ProjectWithJourneys {
  site_id: string
  slug: string
  tester_link: string
  label: string | null
  target_url: string
  created_at: string
  tasks: { id: number; title: string; description: string | null; order_index: number }[]
  journeys: JourneyResponse[]
}

export function saveJourney(
  siteId: string,
  taskTitle: string,
  steps: object[],
  taskId?: number,
  isAgent = true,
  focusAreas?: string[],
) {
  return request<JourneyResponse>('/v1/journeys', {
    method: 'POST',
    body: JSON.stringify({
      site_id: siteId,
      task_title: taskTitle,
      steps,
      task_id: taskId ?? null,
      is_agent: isAgent,
      focus_areas: focusAreas ?? null,
    }),
  })
}

export function listSiteJourneys(siteId: string, source?: string) {
  const qs = source ? `?source=${encodeURIComponent(source)}` : ''
  return request<JourneyResponse[]>(`/v1/sites/${siteId}/journeys${qs}`)
}

export function listJourneyScreenshots(journeyId: number) {
  return request<ScreenshotMeta[]>(`/v1/journeys/${journeyId}/screenshots`)
}

// ─── Screenshots (human sessions) ────────────────────────────────────────────

export interface ScreenshotMeta {
  id: number
  path: string | null
  trigger: string
  action_id: string | null
  created_at_ms: number | null
  ready: boolean
}

export function listSessionScreenshots(sessionId: string) {
  return request<ScreenshotMeta[]>(`/v1/sessions/${sessionId}/screenshots`)
}

export function screenshotImageUrl(screenshotId: number): string {
  return `/api/v1/screenshots/${screenshotId}/image`
}

export function getUserProjects(userId: string) {
  return request<ProjectWithJourneys[]>(`/v1/users/${userId}/projects`)
}

export function deleteSite(siteId: string) {
  return request<void>(`/v1/sites/${siteId}`, { method: 'DELETE' })
}

// ─── Similarity & Comparative Analysis ───────────────────────────────────────

export interface JourneySimilarityItem {
  agent_journey_id: number
  human_journey_id: number
  task_title: string
  similarity: number
}

export function getSiteSimilarity(siteId: string, taskId?: number) {
  const qs = taskId ? `?task_id=${taskId}` : ''
  return request<JourneySimilarityItem[]>(`/v1/sites/${siteId}/similarity${qs}`)
}

export interface CompareHighlight {
  sections?: Array<'stats' | 'action_breakdown' | 'action_mix' | 'steps_per_page' | 'page_revisits' | 'session_variance' | 'time_per_action'>
  side?: 'ai' | 'human' | 'both'
  metrics?: Array<'median_steps' | 'unique_pages' | 'click_rate' | 'scroll_rate' | 'avg_duration' | 'total_steps' | 'avg_steps' | 'shared_pages'>
  action_types?: Array<'click_element' | 'input_text' | 'scroll' | 'navigate' | 'extract_content' | 'other'>
  pages?: string[]
}

export interface DiagramRef {
  view: 'compare' | 'sankey' | 'heatmap' | 'multiflow' | 'similarity' | 'comparative' | 'insights' | 'policy' | 'human_agg'
  reason: string
  highlight?: CompareHighlight
  diagram_explanation?: string
}

export interface ActionPointItem {
  text: string
  agent_explanation?: string
  human_explanation?: string
  agent_bullets?: string[]
  human_bullets?: string[]
  type?: 'ux_issue' | 'agent_gap' | 'human_issue'
  diagrams: DiagramRef[]
}

export interface TaskComparison {
  task_title: string
  agent_journey_count: number
  human_journey_count: number
  similarities: string[]
  differences: string[]
  agent_strengths: string[]
  human_strengths: string[]
  difficulty: 'low' | 'medium' | 'high'
  similarity_comparison?: string
  calibration_summary?: string
  pain_points: ActionPointItem[]
  recommendations: ActionPointItem[]
}

export interface ComparativeAnalysis {
  overall_summary: string
  task_analyses: TaskComparison[]
  cross_task_insights: string[]
  overall_recommendations: string[]
}

export function getStoredAnalysis(siteId: string, versionId: string) {
  return request<ComparativeAnalysis>(
    `/v1/sites/${siteId}/comparative-analysis?version_id=${encodeURIComponent(versionId)}`
  )
}

export function runComparativeAnalysis(siteId: string, taskIds?: number[], versionId = 'v1') {
  return request<ComparativeAnalysis>(`/v1/sites/${siteId}/comparative-analysis`, {
    method: 'POST',
    body: JSON.stringify({ task_ids: taskIds ?? null, version_id: versionId }),
  })
}

// ─── Explain AI ───────────────────────────────────────────────────────────────

export interface RatingsSummary {
  count: number
  overall: number | null
  navigation: number | null
  design: number | null
  comments: string[]
}

export interface ExplainAgentResponse {
  explanation: string
}

export function getRatingsSummary(siteId: string) {
  return request<RatingsSummary>(`/v1/visualizations/sites/${siteId}/ratings-summary`)
}

export function explainAgent(steps: object[], ratings?: RatingsSummary | null) {
  return request<ExplainAgentResponse>('/v1/explain-agent', {
    method: 'POST',
    body: JSON.stringify({ steps, ratings: ratings ?? null }),
  })
}

export interface ExplainAgentPerspectiveResponse { explanation: string }

export function explainAgentPerspective(
  actionPoint: string,
  taskTitle: string,
  agentThoughts: string[],
) {
  return request<ExplainAgentPerspectiveResponse>('/v1/explain-agent-perspective', {
    method: 'POST',
    body: JSON.stringify({ action_point: actionPoint, task_title: taskTitle, agent_thoughts: agentThoughts }),
  })
}

export interface ExplainHumanResponse { explanation: string }

export function explainHuman(
  actionPoint: string,
  taskTitle: string,
  humanNarratives: string[],
  humanComments: string[],
  ratings?: RatingsSummary | null,
) {
  return request<ExplainHumanResponse>('/v1/explain-human', {
    method: 'POST',
    body: JSON.stringify({
      action_point: actionPoint,
      task_title: taskTitle,
      human_narratives: humanNarratives,
      human_comments: humanComments,
      ratings: ratings ?? null,
    }),
  })
}

export interface AnnotationPoint {
  x: number; y: number; label: string
}

export interface AnnotateResult {
  found: boolean
  points: AnnotationPoint[]
  // legacy
  x: number; y: number; width: number; height: number
}

export function annotateScreenshot(screenshotId: number, issueText: string) {
  return request<AnnotateResult>('/v1/annotate-screenshot', {
    method: 'POST',
    body: JSON.stringify({ screenshot_id: screenshotId, issue_text: issueText }),
  })
}

export function selectScreenshot(screenshotIds: number[], issueText: string) {
  return request<{ screenshot_id: number | null }>('/v1/select-screenshot', {
    method: 'POST',
    body: JSON.stringify({ screenshot_ids: screenshotIds, issue_text: issueText }),
  })
}

export interface SynthesizePerspectivesResponse { summary: string }

export function synthesizePerspectives(
  actionPoint: string,
  agentThoughts: string[],
  humanComments: string[],
  ratings?: RatingsSummary | null,
) {
  return request<SynthesizePerspectivesResponse>('/v1/synthesize-perspectives', {
    method: 'POST',
    body: JSON.stringify({
      action_point: actionPoint,
      agent_thoughts: agentThoughts,
      human_comments: humanComments,
      ratings: ratings ?? null,
    }),
  })
}

export interface DiagramLinkExplanation { explanation: string }

// ─── Policy (human aggregate) ─────────────────────────────────────────────────

export interface PagePolicy {
  n_sessions: number
  bounce_rate: number
  avg_time_on_page_ms: number | null
  action_distribution: {
    text: string | null
    href: string | null
    selector: string | null
    count: number
    frequency: number
  }[]
}

export interface SitePolicy {
  site_id: string
  policy: Record<string, PagePolicy>
  n_pages: number
}

export function getSitePolicy(siteId: string, taskId?: number) {
  const qs = taskId ? `?task_id=${taskId}` : ''
  return request<SitePolicy>(`/v1/sites/${siteId}/policy${qs}`)
}

export function explainDiagramLink(
  actionPoint: string,
  diagramType: string,
  stats: Record<string, unknown>,
) {
  return request<DiagramLinkExplanation>('/v1/explain-diagram-link', {
    method: 'POST',
    body: JSON.stringify({ action_point: actionPoint, diagram_type: diagramType, stats }),
  })
}
