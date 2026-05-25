import type { ScreenshotData, HeatmapDot } from './ScreenshotCarousel'
import type { AgentStep } from '../agent/agentTypes'
import type { EventRow } from '../../lib/types'
import type { ScreenshotMeta } from '../../lib/api'
import * as api from '../../lib/api'

const DEFAULT_PLACEHOLDER_SECTIONS = [
  { label: 'Nav', top: 0, left: 0, width: 100, height: 9, color: '#e8eaf0' },
  { label: 'Content', top: 10, left: 0, width: 100, height: 70, color: '#f8f9fc' },
  { label: 'Footer', top: 82, left: 0, width: 100, height: 18, color: '#eef0f5' },
]

const HOMEPAGE_SCREENS: ScreenshotData[] = [
  {
    id: 1, pageLabel: 'Homepage', pageUrl: '/home',
    annotations: [
      { x: 68, y: 18, label: 'CTA buried below fold — 4 testers missed it entirely', type: 'error', arrowDir: 'left' },
      { x: 30, y: 52, label: 'Navigation label unclear — "Solutions" vs "Products"', type: 'warning', arrowDir: 'right' },
      { x: 55, y: 78, label: 'Footer pricing link discovered late by most testers', type: 'info', arrowDir: 'up' },
    ],
    placeholderSections: [
      { label: 'Nav', top: 0, left: 0, width: 100, height: 9, color: '#e8eaf0' },
      { label: 'Hero', top: 10, left: 0, width: 100, height: 28, color: '#f0eeff' },
      { label: 'Nav links', top: 10, left: 4, width: 50, height: 7, color: '#ddd8fa' },
      { label: 'Body', top: 40, left: 0, width: 100, height: 35, color: '#f8f9fc' },
      { label: 'Footer', top: 77, left: 0, width: 100, height: 23, color: '#eef0f5' },
    ],
  },
  {
    id: 2, pageLabel: 'Pricing page', pageUrl: '/pricing',
    annotations: [
      { x: 20, y: 38, label: 'Plan comparison table too wide — horizontal scroll on mobile', type: 'warning', arrowDir: 'right' },
      { x: 62, y: 62, label: '"Most popular" badge not visible on first scroll — 6 of 8 testers missed it', type: 'error', arrowDir: 'left' },
      { x: 75, y: 24, label: 'Agent completed task in 2.1s by targeting this CTA directly', type: 'info', arrowDir: 'down' },
    ],
    placeholderSections: [
      { label: 'Nav', top: 0, left: 0, width: 100, height: 9, color: '#e8eaf0' },
      { label: 'Heading', top: 10, left: 15, width: 70, height: 12, color: '#f0eeff' },
      { label: 'Plan A', top: 26, left: 3, width: 29, height: 46, color: '#eef0f5' },
      { label: 'Plan B', top: 26, left: 35, width: 30, height: 46, color: '#e8eaf0' },
      { label: 'Plan C', top: 26, left: 68, width: 29, height: 46, color: '#f0eeff' },
      { label: 'CTA row', top: 74, left: 3, width: 94, height: 12, color: '#ddd8fa' },
      { label: 'Footer', top: 88, left: 0, width: 100, height: 12, color: '#eef0f5' },
    ],
  },
  {
    id: 3, pageLabel: 'Checkout — Step 1', pageUrl: '/checkout',
    annotations: [
      { x: 18, y: 44, label: 'Field label "Address line 1" confused 3 testers — expected "Street"', type: 'error', arrowDir: 'right' },
      { x: 60, y: 28, label: 'Progress indicator missing — testers unsure how many steps remain', type: 'warning', arrowDir: 'left' },
      { x: 45, y: 80, label: 'Submit button colour contrast too low — flagged by agent', type: 'warning', arrowDir: 'up' },
    ],
    placeholderSections: [
      { label: 'Nav', top: 0, left: 0, width: 100, height: 9, color: '#e8eaf0' },
      { label: 'Form', top: 11, left: 8, width: 55, height: 72, color: '#f8f9fc' },
      { label: 'Summary', top: 11, left: 67, width: 30, height: 55, color: '#f0eeff' },
      { label: 'Field 1', top: 20, left: 10, width: 50, height: 7, color: '#eef0f5' },
      { label: 'Field 2', top: 30, left: 10, width: 50, height: 7, color: '#eef0f5' },
      { label: 'Field 3', top: 40, left: 10, width: 50, height: 7, color: '#eef0f5' },
      { label: 'Submit', top: 70, left: 10, width: 24, height: 9, color: '#c8c4ef' },
      { label: 'Footer', top: 88, left: 0, width: 100, height: 12, color: '#eef0f5' },
    ],
  },
]

export function getScreenshotsForTask(_taskTitle: string): ScreenshotData[] {
  return HOMEPAGE_SCREENS
}

function shortenPath(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '') || '/'
    return path.length > 30 ? path.slice(0, 30) + '…' : path
  } catch { return url.slice(0, 30) }
}

// Agent viewport size (matches backend playwright config)
const AGENT_VIEWPORT_W = 1280
const AGENT_VIEWPORT_H = 800

export function getScreenshotsFromAgentSteps(steps: AgentStep[]): ScreenshotData[] {
  const byPage = new Map<string, AgentStep[]>()
  for (const step of steps) {
    const key = step.url
    if (!byPage.has(key)) byPage.set(key, [])
    byPage.get(key)!.push(step)
  }

  let id = 1
  return Array.from(byPage.entries()).map(([url, pageSteps]) => {
    const lastStep = pageSteps[pageSteps.length - 1]
    const shortLabel = shortenPath(url)

    // Build annotations only from steps that have real element coordinates
    const annotations = pageSteps
      .filter(s => s.element_coordinates !== null)
      .map(s => {
        const ec = s.element_coordinates!
        // element_coordinates are stored as percentages (0-100) by the backend — use directly
        const x = Math.min(98, Math.max(2, ec.x + ec.width / 2))
        const y = Math.min(98, Math.max(2, ec.y + ec.height / 2))
        const detail = s.action_details
        const detailStr = typeof detail === 'object' && detail !== null
          ? Object.values(detail).filter(v => typeof v === 'string').slice(0, 1).join('') || ''
          : ''
        return {
          x,
          y,
          label: `${s.action_type.replace(/_/g, ' ')}${detailStr ? ': ' + String(detailStr).slice(0, 50) : ''}`,
          type: 'info' as const,
          arrowDir: (x < 50 ? 'right' : 'left') as 'right' | 'left',
        }
      })

    // Build click heatmap dots from click steps (browser-use stores as 'click', mapped events as 'click_element')
    const heatmapDots: HeatmapDot[] = pageSteps
      .filter(s => isAgentClick(s.action_type))
      .flatMap(s => {
        // element_coordinates are stored as percentages (0-100) — use directly
        if (s.element_coordinates) {
          const ec = s.element_coordinates
          const x = Math.min(98, Math.max(2, ec.x + ec.width / 2))
          const y = Math.min(98, Math.max(2, ec.y + ec.height / 2))
          return [{ x, y, kind: 'agent' as const }]
        }
        return []
      })

    const screenshotUrl = (lastStep.screenshot_base64 && lastStep.screenshot_base64.length > 0)
      ? `data:image/png;base64,${lastStep.screenshot_base64}`
      : lastStep.screenshot_url ?? undefined

    return {
      id: id++,
      pageLabel: shortLabel,
      pageUrl: url,
      screenshotUrl,
      annotations,
      heatmapDots,
      placeholderSections: screenshotUrl ? [] : DEFAULT_PLACEHOLDER_SECTIONS,
    }
  })
}

function parseEventData(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function mapEventTypeToAction(eventType: string): string {
  const t = eventType.toLowerCase()
  if (t.includes('click')) return 'click_element'
  if (t.includes('input') || t.includes('change') || t.includes('submit') || t.includes('key')) return 'input_text'
  if (t.includes('scroll')) return 'scroll'
  if (t.includes('navigate') || t.includes('route') || t.includes('page')) return 'go_to_url'
  return 'unknown'
}

function shouldUseEvent(eventType: string): boolean {
  const t = eventType.toLowerCase()
  const noisy = ['mousemove', 'pointermove', 'mouseover', 'mouseenter', 'mouseleave', 'mouseout']
  return !noisy.some((n) => t.includes(n))
}

function toAbsoluteUrl(path: string | null, siteUrl: string): string {
  if (!path) return siteUrl
  if (/^https?:\/\//i.test(path)) return path
  try {
    return new URL(path, siteUrl).toString()
  } catch {
    return siteUrl
  }
}

export function getStepsFromSessionEvents(events: EventRow[], siteUrl: string, screenshots: ScreenshotMeta[] = [], viewportW?: number | null, viewportH?: number | null): AgentStep[] {
  const filtered = events
    .filter((e) => shouldUseEvent(e.type))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 200)

  // Build lookup maps: by action_id (precise) and sorted by timestamp (fallback)
  const shotByActionId = new Map<string, ScreenshotMeta>()
  const readyShots = screenshots.filter(s => s.ready && s.created_at_ms != null)
  const shotsSorted = [...readyShots].sort((a, b) => (a.created_at_ms ?? 0) - (b.created_at_ms ?? 0))
  for (const s of screenshots) {
    if (s.action_id && s.ready) shotByActionId.set(s.action_id, s)
  }

  // Effective viewport dimensions for normalizing pixel coordinates to 0-1
  const vpW = (viewportW && viewportW > 0) ? viewportW : HUMAN_VIEWPORT_W
  const vpH = (viewportH && viewportH > 0) ? viewportH : HUMAN_VIEWPORT_H

  return filtered.map((e, i) => {
    const data = parseEventData(e.data)
    // Use element's top-left position (elem_x/elem_y) for element_coordinates when available,
    // falling back to click point (x/y) for backwards compatibility with older events.
    const x = typeof data.elem_x === 'number' ? data.elem_x : (typeof data.x === 'number' ? data.x : null)
    const y = typeof data.elem_y === 'number' ? data.elem_y : (typeof data.y === 'number' ? data.y : null)
    const width = typeof data.width === 'number' ? data.width : null
    const height = typeof data.height === 'number' ? data.height : null

    // Compute normalized click-center coordinates (0-1) using the actual session viewport.
    // Prefer the click point (data.x/data.y) for the center; fall back to element center.
    const clickX = typeof data.x === 'number' ? data.x : (x !== null && width !== null ? x + width / 2 : null)
    const clickY = typeof data.y === 'number' ? data.y : (y !== null && height !== null ? y + height / 2 : null)
    const normalizedCoords = (clickX !== null && clickY !== null)
      ? { x: Math.min(1, Math.max(0, clickX / vpW)), y: Math.min(1, Math.max(0, clickY / vpH)) }
      : undefined

    // Match screenshot: try action_id first, then nearest timestamp within 8 s
    const actionId = typeof data.action_id === 'string' ? data.action_id : null
    let matched = actionId ? shotByActionId.get(actionId) : undefined
    if (!matched && e.timestamp && shotsSorted.length > 0) {
      // Find the screenshot closest in time (taken within 8 s of the event)
      const WINDOW_MS = 8000
      let best: ScreenshotMeta | undefined
      let bestDelta = Infinity
      for (const s of shotsSorted) {
        const delta = Math.abs((s.created_at_ms ?? 0) - e.timestamp)
        if (delta < bestDelta && delta < WINDOW_MS) { bestDelta = delta; best = s }
        if ((s.created_at_ms ?? 0) > e.timestamp + WINDOW_MS) break
      }
      matched = best
    }
    const screenshotUrl = matched ? `/api/v1/screenshots/${matched.id}/image` : undefined

    // Merge normalised coordinates into action_details so heatmap generators
    // always use the correctly-scaled 0-1 values (coordinates key takes priority).
    const enrichedData = normalizedCoords
      ? { ...data, coordinates: normalizedCoords }
      : data

    return {
      step_number: i + 1,
      url: toAbsoluteUrl(e.path, siteUrl),
      title: typeof data.title === 'string' ? data.title : 'User Journey',
      action_type: mapEventTypeToAction(e.type),
      action_details: enrichedData,
      reasoning: `User event: ${e.type}`,
      thought: typeof data.text === 'string' ? data.text : '',
      next_goal: '',
      screenshot_base64: '',
      screenshot_url: screenshotUrl,
      element_coordinates:
        x !== null && y !== null && width !== null && height !== null
          ? { x, y, width, height }
          : null,
      timestamp: e.timestamp,
    }
  })
}

function agentRunKey(siteId: string, versionId?: string): string {
  return versionId ? `ciphercorgi_agent_run_${siteId}_${versionId}` : `ciphercorgi_agent_run_${siteId}`
}

export function loadAgentScreenshots(siteId: string, versionId?: string): ScreenshotData[] | null {
  try {
    const raw = localStorage.getItem(agentRunKey(siteId, versionId))
    if (!raw) return null
    const data = JSON.parse(raw) as { steps: AgentStep[] }
    const shots = getScreenshotsFromAgentSteps(data.steps)
    return shots.length > 0 ? shots : null
  } catch { return null }
}

export function loadAgentSteps(siteId: string, versionId?: string): AgentStep[] | null {
  try {
    const raw = localStorage.getItem(agentRunKey(siteId, versionId))
    if (!raw) return null
    return (JSON.parse(raw) as { steps: AgentStep[] }).steps
  } catch { return null }
}

// Human session viewport size (varies, but using a reasonable default)
const HUMAN_VIEWPORT_W = 1024
const HUMAN_VIEWPORT_H = 768

export function getScreenshotsFromSessionSteps(steps: AgentStep[], screenshotMetas: ScreenshotMeta[]): ScreenshotData[] {
  if (screenshotMetas.length === 0) return []

  // Extract pathname from full URL for comparison
  function getPathname(urlString: string): string {
    try {
      return new URL(urlString).pathname.replace(/\/$/, '') || '/'
    } catch {
      return urlString
    }
  }

  // Build a map of path → steps for quick lookup
  const stepsByPath = new Map<string, AgentStep[]>()
  for (const step of steps) {
    const key = step.url
    if (!stepsByPath.has(key)) stepsByPath.set(key, [])
    stepsByPath.get(key)!.push(step)
  }

  // Process each screenshot (in order) and add annotations for matching steps
  let id = 1
  return screenshotMetas
    .filter(s => s.ready)
    .map((screenshot) => {
      const screenshotPath = screenshot.path ? (screenshot.path.startsWith('/') ? screenshot.path : '/' + screenshot.path) : '/'
      const screenshotPathNormalized = screenshotPath.replace(/\/$/, '') || '/'
      const pageLabel = screenshot.path ? (screenshot.path.split('/').filter(Boolean).pop() || screenshot.path) : `Page ${id}`
      
      // Find all steps that occurred on this page
      let pageSteps: AgentStep[] = []
      for (const [url, stepsForUrl] of stepsByPath.entries()) {
        const urlPathname = getPathname(url)
        // Match if pathnames are equal or if URL ends with the screenshot path
        if (urlPathname === screenshotPathNormalized || urlPathname.endsWith(screenshotPathNormalized)) {
          pageSteps.push(...stepsForUrl)
        }
      }

      // Build annotations from steps that have coordinates
      const annotations = pageSteps
        .filter(s => s.element_coordinates !== null)
        .map(s => {
          const ec = s.element_coordinates!
          // Use centre of the element, clamped to [2, 98]% to avoid edge clipping
          const x = Math.min(98, Math.max(2, ((ec.x + ec.width / 2) / HUMAN_VIEWPORT_W) * 100))
          const y = Math.min(98, Math.max(2, ((ec.y + ec.height / 2) / HUMAN_VIEWPORT_H) * 100))
          const detail = s.action_details
          const detailStr = typeof detail === 'object' && detail !== null
            ? Object.values(detail).filter(v => typeof v === 'string').slice(0, 1).join('') || ''
            : ''
          return {
            x,
            y,
            label: `Step ${s.step_number}: ${s.action_type.replace(/_/g, ' ')}${detailStr ? ' — ' + String(detailStr).slice(0, 45) : ''}`,
            type: 'info' as const,
            arrowDir: (x < 50 ? 'right' : 'left') as 'right' | 'left',
          }
        })

      // Click heatmap dots for human session
      const heatmapDots: HeatmapDot[] = pageSteps
        .filter(s => s.action_type === 'click_element')
        .flatMap(s => {
          const coords = s.action_details?.coordinates as { x: number; y: number } | undefined
          if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
            return [{ x: Math.min(98, Math.max(2, coords.x * 100)), y: Math.min(98, Math.max(2, coords.y * 100)), kind: 'human' as const }]
          }
          if (s.element_coordinates) {
            const ec = s.element_coordinates
            return [{
              x: Math.min(98, Math.max(2, ((ec.x + ec.width / 2) / HUMAN_VIEWPORT_W) * 100)),
              y: Math.min(98, Math.max(2, ((ec.y + ec.height / 2) / HUMAN_VIEWPORT_H) * 100)),
              kind: 'human' as const,
            }]
          }
          return []
        })

      return {
        id: id++,
        pageLabel: pageLabel,
        pageUrl: screenshot.path ?? '/',
        screenshotUrl: api.screenshotImageUrl(screenshot.id),
        annotations,
        heatmapDots,
        placeholderSections: [],
      }
    })
}

// Matches all click-like action types from both agent (browser-use) and human sessions
function isAgentClick(actionType: string): boolean {
  return actionType === 'click_element' || actionType === 'click'
    || actionType === 'select_dropdown' || actionType === 'select_option'
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '') || '/'
    return u.hostname + path + u.search  // keep query params, strip hash
  } catch { return url }
}

export function getAggregatedScreenshots(
  agentJourneys: AgentStep[][],
  humanJourneys: AgentStep[][],
): ScreenshotData[] {
  // bucket all steps by normalized URL, tracking source kind
  const byPage = new Map<string, { url: string; agentSteps: AgentStep[]; humanSteps: AgentStep[] }>()

  function add(steps: AgentStep[], kind: 'agent' | 'human') {
    for (const step of steps) {
      if (!step.url?.startsWith('http')) continue
      const key = normalizeUrl(step.url)
      if (!byPage.has(key)) byPage.set(key, { url: step.url, agentSteps: [], humanSteps: [] })
      byPage.get(key)![kind === 'agent' ? 'agentSteps' : 'humanSteps'].push(step)
    }
  }

  agentJourneys.forEach(j => add(j, 'agent'))
  humanJourneys.forEach(j => add(j, 'human'))

  let id = 1
  return Array.from(byPage.values()).map(({ url, agentSteps, humanSteps }) => {
    // Best screenshot: last agent base64, then last agent screenshot_url, then first human screenshot_url
    const lastAgentBase64 = [...agentSteps].reverse().find(s => s.screenshot_base64 && s.screenshot_base64.length > 0)
    const lastAgentUrl = [...agentSteps].reverse().find(s => s.screenshot_url)
    const firstHumanShot = humanSteps.find(s => s.screenshot_url)
    const screenshotUrl = lastAgentBase64
      ? `data:image/png;base64,${lastAgentBase64.screenshot_base64}`
      : (lastAgentUrl?.screenshot_url ?? firstHumanShot?.screenshot_url)

    // Build annotations from agent step element_coordinates (stored as 0-100% by backend)
    const seen = new Set<string>()
    const annotations = agentSteps
      .filter(s => s.element_coordinates !== null)
      .flatMap(s => {
        const ec = s.element_coordinates!
        const x = Math.min(98, Math.max(2, ec.x + ec.width / 2))
        const y = Math.min(98, Math.max(2, ec.y + ec.height / 2))
        const key = `${Math.round(x)},${Math.round(y)}`
        if (seen.has(key)) return []
        seen.add(key)
        const detail = s.action_details
        const detailStr = typeof detail === 'object' && detail !== null
          ? Object.values(detail).filter(v => typeof v === 'string').slice(0, 1).join('') || ''
          : ''
        return [{
          x,
          y,
          label: `${s.action_type.replace(/_/g, ' ')}${detailStr ? ': ' + String(detailStr).slice(0, 50) : ''}`,
          type: 'info' as const,
          arrowDir: (x < 50 ? 'right' : 'left') as 'right' | 'left',
        }]
      })

    // Aggregate heatmap dots from all click events + VLM attention annotations
    const heatmapDots: HeatmapDot[] = [
      ...agentSteps
        .filter(s => isAgentClick(s.action_type))
        .flatMap(s => {
          // element_coordinates stored as percentages (0-100) — use directly
          if (s.element_coordinates) {
            const ec = s.element_coordinates
            return [{ x: Math.min(98, Math.max(2, ec.x + ec.width / 2)), y: Math.min(98, Math.max(2, ec.y + ec.height / 2)), kind: 'agent' as const }]
          }
          return []
        }),
      ...agentSteps
        .filter(s => s.attention_coordinates != null)
        .map(s => ({
          x: Math.min(98, Math.max(2, s.attention_coordinates!.x)),
          y: Math.min(98, Math.max(2, s.attention_coordinates!.y)),
          kind: 'attention' as const,
        })),
      ...humanSteps
        .filter(s => s.action_type === 'click_element')
        .flatMap(s => {
          const coords = s.action_details?.coordinates as { x: number; y: number } | undefined
          if (coords && typeof coords.x === 'number') {
            return [{ x: Math.min(98, Math.max(2, coords.x * 100)), y: Math.min(98, Math.max(2, coords.y * 100)), kind: 'human' as const }]
          }
          if (s.element_coordinates) {
            const ec = s.element_coordinates
            return [{ x: Math.min(98, Math.max(2, ((ec.x + ec.width / 2) / HUMAN_VIEWPORT_W) * 100)), y: Math.min(98, Math.max(2, ((ec.y + ec.height / 2) / HUMAN_VIEWPORT_H) * 100)), kind: 'human' as const }]
          }
          return []
        }),
    ]

    return {
      id: id++,
      pageLabel: shortenPath(url),
      pageUrl: url,
      screenshotUrl,
      annotations,
      heatmapDots,
      placeholderSections: screenshotUrl ? [] : DEFAULT_PLACEHOLDER_SECTIONS,
    }
  })
}

export function getMockSteps(): AgentStep[] {
  const base = Date.now()
  return [
    { step_number: 1, url: 'https://example.com/', title: 'Homepage', action_type: 'navigate', action_details: { url: 'https://example.com/' }, reasoning: 'Start at homepage', thought: 'Navigate to site', next_goal: 'Find product', screenshot_base64: '', element_coordinates: null, timestamp: base },
    { step_number: 2, url: 'https://example.com/', title: 'Homepage', action_type: 'click_element', action_details: { text: 'Products' }, reasoning: 'Click nav link', thought: 'Look for products nav', next_goal: 'Browse products', screenshot_base64: '', element_coordinates: null, timestamp: base + 2000 },
    { step_number: 3, url: 'https://example.com/products', title: 'Products', action_type: 'scroll', action_details: { direction: 'down' }, reasoning: 'Scroll to see more', thought: 'Need to scroll', next_goal: 'Find item', screenshot_base64: '', element_coordinates: null, timestamp: base + 4000 },
    { step_number: 4, url: 'https://example.com/products', title: 'Products', action_type: 'click_element', action_details: { text: 'View details' }, reasoning: 'Click product', thought: 'Found product', next_goal: 'See pricing', screenshot_base64: '', element_coordinates: null, timestamp: base + 6000 },
    { step_number: 5, url: 'https://example.com/pricing', title: 'Pricing', action_type: 'extract_content', action_details: { selector: '.price' }, reasoning: 'Extract price', thought: 'Read price info', next_goal: 'Complete task', screenshot_base64: '', element_coordinates: null, timestamp: base + 8000 },
    { step_number: 6, url: 'https://example.com/pricing', title: 'Pricing', action_type: 'done', action_details: { success: true }, reasoning: 'Task complete', thought: 'Found what I needed', next_goal: '', screenshot_base64: '', element_coordinates: null, timestamp: base + 9000 },
  ]
}

export interface HumanTaskJourney {
  taskId: string | null
  taskTitle: string
  taskIndex: number
  steps: AgentStep[]
  outcome: 'success' | 'failed' | null   // null if no outcome recorded yet
}
 
export function getTaskJourneysFromSessionEvents(
  events: EventRow[],
  siteUrl: string,
  screenshots: ScreenshotMeta[] = [],
  viewportW?: number | null,
  viewportH?: number | null,
): HumanTaskJourney[] {
  const outcomeEvents = events.filter(e => e.type === 'task_outcome')
  const completeEvents = events.filter(e => e.type === 'task_complete')
  console.log('[taskJourneys] events:', events.length,
    '| task_outcome:', outcomeEvents.length,
    '| task_complete:', completeEvents.length)

  // Show actual parsed data for debugging
  for (const e of outcomeEvents) {
    try {
      const d = e.data ? JSON.parse(e.data) : {}
      console.log('[taskJourneys] outcome event data:', d)
    } catch (err) {
      console.log('[taskJourneys] outcome event UNPARSEABLE:', e.data, err)
    }
  }
  for (const e of completeEvents) {
    try {
      const d = e.data ? JSON.parse(e.data) : {}
      console.log('[taskJourneys] complete event data:', d)
    } catch (err) {
      console.log('[taskJourneys] complete event UNPARSEABLE:', e.data, err)
    }
  }

  const sortedAll = [...events].sort((a, b) => a.timestamp - b.timestamp)
 
  // task_outcome events: latest verdict wins per task_title
  const outcomeByTaskTitle = new Map<string, 'success' | 'failed'>()
  for (const e of sortedAll) {
    if (e.type !== 'task_outcome') continue
    let data: Record<string, unknown> = {}
    try { data = e.data ? JSON.parse(e.data) : {} } catch { console.log('[taskJourneys] parse fail:', e.data); continue }
    console.log('[taskJourneys] outcome loop:', { title: data.task_title, outcome: data.outcome, willSet: (data.outcome === 'success' || data.outcome === 'failed') })
    const title = typeof data.task_title === 'string' ? data.task_title : null
    const outcome = data.outcome
    if (!title) continue
    if (outcome === 'success' || outcome === 'failed') {
      outcomeByTaskTitle.set(title, outcome)
    }
  }
  console.log('[taskJourneys] outcomeByTaskTitle map:', Array.from(outcomeByTaskTitle.entries()))
 
  // task_complete boundaries with their metadata
  type Boundary = { timestamp: number; taskTitle: string; taskId: string | null; taskIndex: number }
  const boundaries: Boundary[] = []
  for (const e of sortedAll) {
    if (e.type !== 'task_complete') continue
    const data = parseEventData(e.data)
    boundaries.push({
      timestamp: e.timestamp,
      taskTitle: typeof data.task_title === 'string' ? data.task_title : `Task ${boundaries.length + 1}`,
      taskId: typeof data.task_id === 'string' || typeof data.task_id === 'number'
        ? String(data.task_id) : null,
      taskIndex: typeof data.task_index === 'number' ? data.task_index : boundaries.length,
    })
  }
 
  // No boundaries → fall back to one journey for the whole session.
  // This handles legacy sessions where the user never clicked "Task done".
  if (boundaries.length === 0) {
    const steps = getStepsFromSessionEvents(events, siteUrl, screenshots, viewportW, viewportH)
    if (steps.length === 0) return []
    return [{
      taskId: null,
      taskTitle: 'session',
      taskIndex: 0,
      steps,
      outcome: null,  // no outcome recorded for unbounded sessions
    }]
  }
 
  // ── Step 2: split the event stream by the boundary timestamps. Each task
  // gets events from (previous boundary OR session start, inclusive of that
  // moment) up to (its own task_complete event, inclusive).
  const journeys: HumanTaskJourney[] = []
  let prevTs = -Infinity
  for (const b of boundaries) {
    // Events strictly between prevTs and b.timestamp belong to THIS task.
    // We include events with timestamp <= b.timestamp so the task_complete
    // itself (and its preceding steps) are part of the task it concludes.
    const slice = sortedAll.filter(e =>
      e.timestamp > prevTs &&
      e.timestamp <= b.timestamp &&
      // Don't include task_outcome / task_complete events in the step list
      // themselves — they're metadata, not user actions.
      e.type !== 'task_outcome' &&
      e.type !== 'task_complete'
    )
    const steps = getStepsFromSessionEvents(slice, siteUrl, screenshots, viewportW, viewportH)
    const outcome = outcomeByTaskTitle.get(b.taskTitle) ?? null
    console.log('[taskJourneys] lookup:', { 
      lookFor: b.taskTitle, 
      found: outcome, 
      mapKeys: Array.from(outcomeByTaskTitle.keys()),
      exactMatch: outcomeByTaskTitle.has(b.taskTitle),
    })
    if (steps.length > 0) {
      // Stamp outcome on the final step so the Sankey can pick the terminal
      // milestone (✓ done / ⚠ failed). Mutates the last step in place.
      if (outcome) {
        // @ts-ignore — outcome is not on the strict AgentStep type
        steps[steps.length - 1].outcome = outcome
      }
      journeys.push({
        taskId: b.taskId,
        taskTitle: b.taskTitle,
        taskIndex: b.taskIndex,
        steps,
        outcome,
      })
    }
    prevTs = b.timestamp
  }
 

  
  console.log('[taskJourneys] FINAL:', journeys.map(j => ({
    title: j.taskTitle,
    outcome: j.outcome,
    steps: j.steps.length,
    lastStepOutcome: j.steps.length > 0 ? (j.steps[j.steps.length - 1] as any).outcome : 'no-steps',
  })))
  return journeys
}