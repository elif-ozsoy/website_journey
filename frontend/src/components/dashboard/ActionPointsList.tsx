import React, { useState, useEffect, useRef, useMemo } from 'react'
import type { ComparativeAnalysis, TaskComparison, ScreenshotMeta, AnnotateResult, AnnotationPoint, JourneyResponse, ActionPointItem, DiagramRef } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'

// ─── Types ────────────────────────────────────────────────────────────────────

type PointStatus = 'open' | 'done' | 'skipped'
type PointType = 'pain_point' | 'recommendation'

interface ActionPoint {
  id: string
  item: ActionPointItem
  type: PointType
  task: TaskComparison
  status: PointStatus
  severity: 'high' | 'medium'
  ppIndex: number
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STATUS_KEY = (s: string) => `ciphercorgi_action_points_${s}`
function loadStatuses(siteId: string): Record<string, PointStatus> {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY(siteId)) ?? '{}') } catch { return {} }
}
function saveStatuses(siteId: string, s: Record<string, PointStatus>) {
  localStorage.setItem(STATUS_KEY(siteId), JSON.stringify(s))
}

const ANN_KEY = (s: string) => `ciphercorgi_annotations_v8_${s}`
function loadAnnotations(siteId: string): Map<string, AnnotateResult> {
  try {
    const raw = localStorage.getItem(ANN_KEY(siteId))
    if (!raw) return new Map()
    return new Map(Object.entries(JSON.parse(raw) as Record<string, AnnotateResult>))
  } catch { return new Map() }
}
function saveAnnotations(siteId: string, m: Map<string, AnnotateResult>) {
  try { localStorage.setItem(ANN_KEY(siteId), JSON.stringify(Object.fromEntries(m))) } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Normalise a raw pain_points/recommendations entry to ActionPointItem.
 *  Handles both old string format (from cached analyses) and the new object format. */
function toItem(raw: ActionPointItem | string): ActionPointItem {
  if (typeof raw === 'string') return { text: raw, diagrams: [] }
  return raw
}


function derivePoints(analysis: ComparativeAnalysis): Omit<ActionPoint, 'status'>[] {
  const pts: Omit<ActionPoint, 'status'>[] = []
  for (const task of analysis.task_analyses) {
    const diff = task.difficulty as 'high' | 'medium' | 'low'
    if (diff === 'low') continue
    const severity: 'high' | 'medium' = diff === 'high' ? 'high' : 'medium'
    for (let i = 0; i < task.pain_points.length; i++) {
      const item = toItem(task.pain_points[i] as ActionPointItem | string)
      if (!item.text.trim()) continue
      pts.push({ id: `pp_${task.task_title}_${i}`, item, type: 'pain_point', task, severity, ppIndex: i })
    }
  }
  return pts.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'pain_point' ? -1 : 1
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  })
}


function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 4px', fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{children}</p>
}

/** Render text with **bold** markdown as actual bold spans, split into paragraphs on blank lines. */
function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  return (
    <>
      {paragraphs.map((para, pi) => {
        const parts = para.split(/\*\*/)
        return (
          <p key={pi} style={{ margin: pi > 0 ? '6px 0 0' : 0, ...style }}>
            {parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}
          </p>
        )
      })}
    </>
  )
}

function Spinner({ size = 10 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0, border: `${Math.max(1.5, size / 6)}px solid var(--gray200)`, borderTopColor: 'var(--brand)', animation: 'spin 0.7s linear infinite' }} />
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  siteId: string
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  compareError: string | null
  onRunAnalysis: () => void
  onRerunAnalysis: () => void
  agentJourneyIds: number[]
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
  taskFilter: number | null
  tasks: { id: number; title: string }[]
  onNavigateTo: (tab: string, view?: string, note?: string, diagramRef?: DiagramRef) => void
  ratingsSummary: api.RatingsSummary | null
  compact?: boolean
  analysisRunId?: number
  /** Called whenever the action-point-specific screenshot or annotation changes.
   *  pending=true means selection/annotation is still in progress. */
  onScreenshotChange?: (screenshot: ScreenshotMeta | null, annotation: AnnotateResult | null, pending: boolean) => void
}

// ─── Diagram stats ────────────────────────────────────────────────────────────

export interface DiagramStats {
  agentAvgSteps: number | null
  humanAvgSteps: number | null
  agentUniquePages: number
  humanUniquePages: number
  totalJourneys: number
  agentCount: number
  humanCount: number
  /** Pages visited by agents but not by any human */
  agentOnlyPages: string[]
  /** Pages visited by humans but not by any agent */
  humanOnlyPages: string[]
}

function uniquePages(stepArrays: AgentStep[][]): Set<string> {
  const s = new Set<string>()
  for (const steps of stepArrays)
    for (const st of steps)
      if (st.url?.startsWith('http')) {
        try { s.add(new URL(st.url).pathname) } catch { s.add(st.url) }
      }
  return s
}

function computeStats(
  taskTitle: string,
  agentJourneys: JourneyResponse[],
  humanJourneySteps: AgentStep[][],
): DiagramStats {
  const taskAgentJourneys = agentJourneys.filter(j => j.task_title === taskTitle || !taskTitle)
  const agentStepCounts = taskAgentJourneys.map(j => j.total_steps).filter(n => n > 0)
  const humanStepCounts = humanJourneySteps.map(s => s.length).filter(n => n > 0)

  const agentPages = uniquePages(taskAgentJourneys.map(j => j.steps as AgentStep[]))
  const humanPages = uniquePages(humanJourneySteps)

  const agentOnlyPages = [...agentPages].filter(p => !humanPages.has(p)).slice(0, 3)
  const humanOnlyPages = [...humanPages].filter(p => !agentPages.has(p)).slice(0, 3)

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

  return {
    agentAvgSteps: avg(agentStepCounts),
    humanAvgSteps: avg(humanStepCounts),
    agentUniquePages: agentPages.size,
    humanUniquePages: humanPages.size,
    totalJourneys: taskAgentJourneys.length + humanJourneySteps.length,
    agentCount: taskAgentJourneys.length,
    humanCount: humanJourneySteps.length,
    agentOnlyPages,
    humanOnlyPages,
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ActionPointsList({
  siteId, compareAnalysis, compareLoading, compareError,
  onRunAnalysis, onRerunAnalysis, agentJourneyIds,
  agentJourneys, humanJourneySteps,
  taskFilter, tasks, onNavigateTo, ratingsSummary, compact = false,
  analysisRunId, onScreenshotChange,
}: Props) {
  const [statuses, setStatuses] = useState<Record<string, PointStatus>>(() => loadStatuses(siteId))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [allShots, setAllShots] = useState<ScreenshotMeta[]>([])
  const [shotsLoading, setShotsLoading] = useState(false)
  // AI-selected screenshot per point: key = pointId → screenshotId (null = no matching screenshot found)
  const [selections, setSelections] = useState<Map<string, number | null>>(() => {
    try {
      return new Map(
        Object.entries(JSON.parse(localStorage.getItem(`ciphercorgi_selections_v3_${siteId}`) ?? '{}')).map(
          ([k, v]) => [k, v === null ? null : Number(v)]
        )
      )
    } catch { return new Map() }
  })
  // annotation per point+screenshot: key = `${pointId}:${screenshotId}` → AnnotateResult
  const [annotations, setAnnotations] = useState<Map<string, AnnotateResult>>(() => loadAnnotations(siteId))
  const selectingRef = useRef(new Set<string>())
  const annotatingRef = useRef(new Set<string>())

  useEffect(() => {
    if (!analysisRunId) return  // 0 = initial mount, don't clear cached data
    setSelections(new Map())
    setAnnotations(new Map())
    selectingRef.current.clear()
    annotatingRef.current.clear()
    selQueueRef.current = []
    annQueueRef.current = []
    selActiveRef.current = 0
    annActiveRef.current = 0
    localStorage.removeItem(`ciphercorgi_selections_v3_${siteId}`)
    localStorage.removeItem(ANN_KEY(siteId))
  }, [analysisRunId])

  useEffect(() => { saveStatuses(siteId, statuses) }, [siteId, statuses])
  useEffect(() => { saveAnnotations(siteId, annotations) }, [siteId, annotations])
  useEffect(() => {
    try { localStorage.setItem(`ciphercorgi_selections_v3_${siteId}`, JSON.stringify(Object.fromEntries(selections))) } catch {}
  }, [siteId, selections])

  useEffect(() => {
    if (agentJourneyIds.length === 0) return
    setShotsLoading(true)
    console.log('[CC:shots] loading screenshots for journeys:', agentJourneyIds)
    Promise.all(agentJourneyIds.map(id => api.listJourneyScreenshots(id).catch(() => [] as ScreenshotMeta[])))
      .then(r => {
        const flat = r.flat().filter(sc => sc.ready)
        const seen = new Set<number>()
        const unique = flat.filter(sc => { if (seen.has(sc.id)) return false; seen.add(sc.id); return true })
        console.log(`[CC:shots] loaded ${unique.length} unique screenshots:`, unique.map(s => `${s.id}:${s.path ?? '?'}`))
        setAllShots(unique)
      })
      .finally(() => setShotsLoading(false))
  }, [agentJourneyIds.join(',')])

  const rawPoints = compareAnalysis ? derivePoints(compareAnalysis) : []
  const activeTaskTitle = taskFilter !== null ? (tasks.find(t => t.id === taskFilter)?.title ?? null) : null
  const filteredRaw = activeTaskTitle ? rawPoints.filter(p => p.task.task_title === activeTaskTitle) : rawPoints
  const points: ActionPoint[] = filteredRaw.map(p => ({ ...p, status: statuses[p.id] ?? 'open' }))

  useEffect(() => {
    if (points.length > 0 && (selectedId === null || !points.find(p => p.id === selectedId)))
      setSelectedId(points[0].id)
  }, [points.length, activeTaskTitle])

  // Step 1: AI screenshot selection queue (max 2 concurrent)
  // selText: pain-point description used to pick the right screenshot
  // annText: recommendation text used to annotate WHERE the fix should be applied
  const selQueueRef = useRef<Array<{ pointId: string; selText: string; annText: string; shotIds: number[] }>>([])
  const selActiveRef = useRef(0)

  function drainSelQueue() {
    while (selActiveRef.current < 1 && selQueueRef.current.length > 0) {
      const job = selQueueRef.current.shift()!
      selActiveRef.current++
      console.log(`[CC:sel] START ${job.pointId} | candidates: ${job.shotIds.length} shots | text: "${job.selText.slice(0, 60)}"`)
      api.selectScreenshot(job.shotIds, job.selText)
        .then(r => {
          const shotId = r.screenshot_id  // null = model found no matching screenshot
          console.log(`[CC:sel] DONE  ${job.pointId} → shotId: ${shotId}`)
          setSelections(m => new Map(m).set(job.pointId, shotId))
          if (shotId !== null) enqueueAnnotation(job.pointId, shotId, job.annText, false)
          else console.warn(`[CC:sel] NO MATCH for ${job.pointId} — no annotation will run`)
        })
        .catch((err) => {
          // Network/API failure — fall back to first candidate so we still show something
          const shotId = job.shotIds[0]
          console.warn(`[CC:sel] ERROR ${job.pointId}:`, err, `→ fallback shotId: ${shotId}`)
          setSelections(m => new Map(m).set(job.pointId, shotId))
          enqueueAnnotation(job.pointId, shotId, job.annText, false)
        })
        .finally(() => {
          selectingRef.current.delete(job.pointId)
          selActiveRef.current--
          drainSelQueue()
        })
    }
  }

  // Step 2: annotation queue (max 2 concurrent)
  const annQueueRef = useRef<Array<{ key: string; shotId: number; text: string }>>([])
  const annActiveRef = useRef(0)

  function drainAnnQueue() {
    while (annActiveRef.current < 1 && annQueueRef.current.length > 0) {
      const job = annQueueRef.current.shift()!
      annActiveRef.current++
      console.log(`[CC:ann] START ${job.key} | shotId: ${job.shotId} | text: "${job.text.slice(0, 60)}"`)
      api.annotateScreenshot(job.shotId, job.text)
        .then(r => {
          console.log(`[CC:ann] API   ${job.key} → found: ${r.found}, points: ${r.points.length}`, r.points.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)}) "${p.label.slice(0, 40)}"`))
          // If backend returned no points, synthesise a fallback center dot so
          // the UI always shows at least one annotation marker.
          if (!r.found || r.points.length === 0) {
            const label = job.text.slice(0, 80) + (job.text.length > 80 ? '…' : '')
            console.warn(`[CC:ann] FALLBACK ${job.key} (found=${r.found}, pts=${r.points.length}) → center dot`)
            r = { found: true, points: [{ x: 50, y: 40, label }], x: 50, y: 40, width: 0.1, height: 0.05 }
          }
          setAnnotations(m => new Map(m).set(job.key, r))
        })
        .catch((err) => {
          // API error — synthesise fallback rather than storing permanent "no dot"
          console.error(`[CC:ann] ERROR ${job.key}:`, err, '→ center fallback dot')
          const label = job.text.slice(0, 80) + (job.text.length > 80 ? '…' : '')
          setAnnotations(m => new Map(m).set(job.key, {
            found: true, points: [{ x: 50, y: 40, label }], x: 50, y: 40, width: 0.1, height: 0.05,
          }))
        })
        .finally(() => {
          annotatingRef.current.delete(job.key)
          annActiveRef.current--
          drainAnnQueue()
        })
    }
  }

  function enqueueAnnotation(pointId: string, shotId: number, text: string, prepend: boolean) {
    const key = `${pointId}:${shotId}`
    if (annotations.has(key)) {
      console.log(`[CC:ann] SKIP  ${key} (already in cache)`)
      return
    }
    if (annotatingRef.current.has(key)) {
      console.log(`[CC:ann] SKIP  ${key} (already in-flight)`)
      return
    }
    console.log(`[CC:ann] QUEUE ${key} | prepend: ${prepend}`)
    annotatingRef.current.add(key)
    if (prepend) annQueueRef.current.unshift({ key, shotId, text })
    else annQueueRef.current.push({ key, shotId, text })
    drainAnnQueue()
  }

  // Return the text used to annotate the screenshot: the pain-point description itself.
  // Recommendations are a separate, independently-indexed list and are NOT paired to pain_points by index.
  function annTextFor(p: ActionPoint): string {
    return p.item.text
  }

  // Kick off selection for points without a selected screenshot
  useEffect(() => {
    if (allShots.length === 0 || points.length === 0) return
    for (const p of points.slice(0, 20)) {
      if (selections.has(p.id)) {
        const shotId = selections.get(p.id) ?? null
        if (shotId !== null) enqueueAnnotation(p.id, shotId, annTextFor(p), false)
        continue
      }
      if (selectingRef.current.has(p.id)) continue  // selection in progress
      selectingRef.current.add(p.id)
      selQueueRef.current.push({ pointId: p.id, selText: p.item.text, annText: annTextFor(p), shotIds: allShots.map(s => s.id) })
    }
    drainSelQueue()
  }, [allShots.length, points.map(p => p.id).join(','), analysisRunId])

  // Prioritise selected point: move it to front of queues
  useEffect(() => {
    if (!selectedId || allShots.length === 0) return
    const p = points.find(pt => pt.id === selectedId)
    if (!p) return
    if (selections.has(p.id)) {
      const shotId = selections.get(p.id) ?? null
      if (shotId !== null) enqueueAnnotation(p.id, shotId, annTextFor(p), true)
    } else if (!selectingRef.current.has(p.id)) {
      selectingRef.current.add(p.id)
      selQueueRef.current.unshift({ pointId: p.id, selText: p.item.text, annText: annTextFor(p), shotIds: allShots.map(s => s.id) })
      drainSelQueue()
    }
  }, [selectedId, allShots.length, analysisRunId])

  function setStatus(id: string, s: PointStatus) { setStatuses(prev => ({ ...prev, [id]: s })) }
  function advance() {
    const idx = points.findIndex(p => p.id === selectedId)
    const next = points[idx + 1]
    if (next) setSelectedId(next.id)
  }

  const selected = points.find(p => p.id === selectedId) ?? null
  const openCount = points.filter(p => (statuses[p.id] ?? 'open') === 'open').length

  // Compute the exact screenshot + annotation for the currently selected point.
  // Using these as effect deps means the callback fires only when THIS point's
  // data changes — not on every unrelated annotation completing.
  const selectedShotId = selected ? (selections.get(selected.id) ?? null) : null
  const selectedSc = selectedShotId !== null ? (allShots.find(s => s.id === selectedShotId) ?? null) : null
  const selectedAnn = (selected && selectedShotId !== null)
    ? (annotations.get(`${selected.id}:${selectedShotId}`) ?? null)
    : null
  // pending = selection hasn't completed yet, OR screenshot found but annotation still running
  const selectedPending = selected
    ? (!selections.has(selected.id) || (selectedShotId !== null && !annotations.has(`${selected.id}:${selectedShotId}`)))
    : false

  useEffect(() => {
    console.log(
      `[CC:cb] onScreenshotChange | sc: ${selectedSc?.id ?? 'null'} | ann: ${selectedAnn ? `found=${selectedAnn.found} pts=${selectedAnn.points.length}` : 'null'} | pending: ${selectedPending}`
    )
    onScreenshotChange?.(selectedSc, selectedAnn, selectedPending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSc, selectedAnn, selectedPending])

  // Compute diagram stats for the selected point's task
  const selectedStats = useMemo(() =>
    selected ? computeStats(selected.task.task_title, agentJourneys, humanJourneySteps) : null,
    [selected?.task.task_title, agentJourneys, humanJourneySteps],
  )
  const pendingAnnotations = points.slice(0, 10).filter(p => {
    if (!selections.has(p.id)) return true
    const shotId = selections.get(p.id) ?? null
    if (shotId === null) return false  // no match — not pending
    return !annotations.has(`${p.id}:${shotId}`)
  }).length

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!compareAnalysis) {
    return (
      <div style={{ flex: 1, borderLeft: '1px solid var(--border)', background: 'var(--surface)', padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 'var(--fs-body)', color: 'var(--brand)' }}>!</span>
          </div>
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>Action Points</span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray500)', lineHeight: 1.65 }}>
          Run Comparative Analysis to generate prioritised action points from AI agent and human tester data.
        </p>
        {compareError && (
          <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fff4f2', border: '1px solid #fca5a5', fontSize: 'var(--fs-body)', color: '#dc2626', lineHeight: 1.5 }}>
            {compareError.includes('No journeys') ? 'No journeys recorded yet. Run an AI agent and collect at least one human tester session first.' : compareError}
          </div>
        )}
        <button onClick={onRunAnalysis} disabled={compareLoading} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 9, border: 'none', cursor: compareLoading ? 'not-allowed' : 'pointer', background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-body)', fontWeight: 700 }}>
          {compareLoading && <Spinner />}
          {compareLoading ? 'Running analysis…' : compareError ? 'Retry' : 'Run Analysis →'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '0', borderLeft: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>

      {/* Header + nav dots */}
      <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--gray50)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>Action Points</span>

        {openCount === 0 && points.length > 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>all resolved ✓</span>}
        {pendingAnnotations > 0 && allShots.length > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', color: 'var(--gray400)', flexShrink: 0 }}>
            <Spinner size={9} /> Locating issues…
          </span>
        )}
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          {points.map((p, i) => {
            const s = statuses[p.id] ?? 'open'
            const isActive = p.id === selectedId
            const bg = isActive ? 'var(--brand)' : s === 'done' ? '#2563eb33' : s === 'skipped' ? 'var(--gray300)' : 'var(--gray200)'
            const fg = isActive ? '#fff' : s === 'done' ? 'var(--brand)' : s === 'skipped' ? 'var(--gray600)' : 'var(--gray500)'
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)} title={p.item.text.slice(0, 80)} style={{
                width: isActive ? 28 : 22, height: 22, borderRadius: isActive ? 7 : '50%',
                border: isActive ? '2px solid var(--brand)' : '1.5px solid transparent',
                cursor: 'pointer', fontSize: 'var(--fs-small)', fontWeight: 700, transition: 'all 0.15s',
                background: bg, color: fg,
              }}>
                <span style={{ textDecoration: s === 'skipped' ? 'line-through' : 'none' }}>{i + 1}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Body */}
      {selected && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '55% 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {!compact && (() => {
            const rawShotId = selections.get(selected.id)  // undefined = not yet selected, null = no match
            const shotId = rawShotId ?? null
            const noMatch = selections.has(selected.id) && shotId === null
            const sc = shotId !== null ? (allShots.find(s => s.id === shotId) ?? null) : null
            const ann = shotId !== null ? (annotations.get(`${selected.id}:${shotId}`) ?? null) : null
            const pending = !selections.has(selected.id) || (shotId !== null && !annotations.has(`${selected.id}:${shotId}`))
            return (
              <div style={{ borderRight: '1px solid var(--border)', background: '#0f172a', position: 'relative', minHeight: 480 }}>
                {shotsLoading ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Spinner size={20} />
                  </div>
                ) : noMatch ? (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#475569' }}>
                    <span style={{ fontSize: 'var(--fs-headline)', opacity: 0.35 }}>🖼</span>
                    <span style={{ fontSize: 'var(--fs-small)' }}>No matching screenshot for this action point</span>
                  </div>
                ) : sc ? (
                  <ScreenshotView
                    screenshot={sc}
                    annotation={ann}
                    pending={pending}
                  />
                ) : pending ? (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#475569' }}>
                    <Spinner size={20} />
                    <span style={{ fontSize: 'var(--fs-small)' }}>Selecting screenshot…</span>
                  </div>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#475569' }}>
                    <span style={{ fontSize: 'var(--fs-headline)', opacity: 0.35 }}>🖼</span>
                    <span style={{ fontSize: 'var(--fs-small)' }}>No screenshot available</span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Detail */}
          <IssueDetail
            point={selected}
            idx={points.indexOf(selected)}
            total={points.length}
            status={statuses[selected.id] ?? 'open'}
            stats={selectedStats}
            agentJourneys={agentJourneys}
            humanJourneySteps={humanJourneySteps}
            ratingsSummary={ratingsSummary}
            onDone={() => { const was = (statuses[selected.id] ?? 'open') === 'done'; setStatus(selected.id, was ? 'open' : 'done'); if (!was) advance() }}
            onSkip={() => { const was = (statuses[selected.id] ?? 'open') === 'skipped'; setStatus(selected.id, was ? 'open' : 'skipped'); if (!was) advance() }}
            onPrev={() => { const i = points.findIndex(p => p.id === selected.id); setSelectedId(points[(i - 1 + points.length) % points.length].id) }}
            onNext={() => { const i = points.findIndex(p => p.id === selected.id); setSelectedId(points[(i + 1) % points.length].id) }}
            onNavigateTo={onNavigateTo}
            compact={compact}
          />
        </div>
      )}
    </div>
  )
}

// ─── Screenshot with annotation overlay ──────────────────────────────────────

// Project palette: red → brand blue → amber → accent-bright → deeper blue
const DOT_PALETTE = ['#C73E1D', '#185FA5', '#d97706', '#378ADD']

function AnnotationDot({ point, dotIndex = 0 }: { point: AnnotationPoint; dotIndex?: number }) {
  const [open, setOpen] = useState(false)
  const color = DOT_PALETTE[dotIndex % DOT_PALETTE.length]
  const above = point.y > 15

  return (
    <div
      role="button"
      onClick={() => setOpen(o => !o)}
      style={{
        position: 'absolute',
        left: `${point.x}%`, top: `${point.y}%`,
        transform: 'translate(-50%,-50%)',
        zIndex: 10, cursor: 'pointer',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        background: color,
        border: '2.5px solid #fff',
        boxShadow: `0 0 0 3px ${color}55, 0 2px 8px rgba(0,0,0,0.5)`,
      }} />

      {open && (
        <div style={{
          position: 'absolute',
          left: '50%', transform: 'translateX(-50%)',
          ...(above ? { bottom: 'calc(100% + 10px)' } : { top: 'calc(100% + 10px)' }),
          width: 220, padding: '8px 10px', borderRadius: 8,
          background: '#0f172a', color: '#e2e8f0',
          fontSize: 'var(--fs-small)', lineHeight: 1.55, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          border: `1px solid ${color}55`,
          zIndex: 20, pointerEvents: 'none',
          whiteSpace: 'normal',
        }}>
          {point.label}
          <div style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            ...(above
              ? { bottom: -5, borderTop: `5px solid #0f172a`, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: 'none' }
              : { top: -5, borderBottom: `5px solid #0f172a`, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: 'none' }),
            width: 0, height: 0,
          }} />
        </div>
      )}
    </div>
  )
}

function ScreenshotView({ screenshot, annotation, pending }: {
  screenshot: ScreenshotMeta
  annotation: AnnotateResult | null
  pending: boolean
}) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <img
        src={api.screenshotImageUrl(screenshot.id)}
        alt=""
        style={{ width: '100%', height: 'auto', display: 'block', opacity: 0.9 }}
      />

      {pending && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(135deg, transparent 40%, rgba(37,99,235,0.05) 60%, transparent 80%)',
          backgroundSize: '200% 200%', animation: 'scan 1.6s linear infinite',
        }} />
      )}

      {annotation?.found && annotation.points.map((pt, i) => (
        <AnnotationDot key={i} point={pt} dotIndex={i} />
      ))}

      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', pointerEvents: 'none' }}>
        {screenshot.path && (
          <div style={{ background: 'rgba(15,23,42,0.72)', color: '#94a3b8', fontSize: 'var(--fs-small)', fontFamily: 'var(--font-sans)', padding: '2px 7px', borderRadius: 5 }}>
            {screenshot.path}
          </div>
        )}
        {pending && (
          <div style={{ background: 'rgba(15,23,42,0.72)', color: '#94a3b8', fontSize: 'var(--fs-small)', padding: '3px 8px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Spinner size={8} /> Locating…
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Issue detail ─────────────────────────────────────────────────────────────

/** One-line summary of the numbers that generated this action point. */
function derivationSummary(task: TaskComparison, stats: DiagramStats | null): string {
  const parts: string[] = []
  if (stats?.agentAvgSteps != null && stats.humanAvgSteps != null) {
    const ratio = stats.humanAvgSteps > 0 ? (stats.agentAvgSteps / stats.humanAvgSteps).toFixed(1) : null
    parts.push(`AI avg ${stats.agentAvgSteps} steps · Human avg ${stats.humanAvgSteps} steps${ratio ? ` (${ratio}×)` : ''}`)
  }
  if (stats?.agentUniquePages != null && stats.humanUniquePages != null && stats.agentUniquePages !== stats.humanUniquePages)
    parts.push(`${stats.agentUniquePages} pages (AI) vs ${stats.humanUniquePages} (human)`)
  if (task.agent_journey_count > 0 && task.human_journey_count > 0)
    parts.push(`across ${task.agent_journey_count} AI run${task.agent_journey_count !== 1 ? 's' : ''} + ${task.human_journey_count} human session${task.human_journey_count !== 1 ? 's' : ''}`)
  return parts.join(' · ')
}

/** Pick agent thoughts from steps that are keyword-relevant to the action point text. */
function relevantAgentThoughts(journeys: JourneyResponse[], taskTitle: string, pointText: string, n = 4): string[] {
  const words = pointText.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  const taskJourneys = journeys.filter(j => !taskTitle || j.task_title === taskTitle)
  const thoughts: { text: string; score: number }[] = []
  for (const j of taskJourneys) {
    for (const step of (j.steps as AgentStep[])) {
      const t = ((step.thought ?? '') + ' ' + (step.reasoning ?? '')).trim()
      if (!t) continue
      const tl = t.toLowerCase()
      const score = words.filter(w => tl.includes(w)).length
      if (score > 0) thoughts.push({ text: t, score })
    }
  }
  thoughts.sort((a, b) => b.score - a.score)
  // deduplicate near-duplicate thoughts (same first 80 chars)
  const seen = new Set<string>()
  const result: string[] = []
  for (const th of thoughts) {
    const key = th.text.slice(0, 80)
    if (!seen.has(key)) { seen.add(key); result.push(th.text) }
    if (result.length >= n) break
  }
  return result
}

const ACTION_VERBS: Record<string, string> = {
  click: 'clicked', scroll: 'scrolled on', input: 'typed into', navigate: 'navigated to',
  hover: 'hovered over', submit: 'submitted form on', back: 'went back from',
}

/** Derive readable narrative sentences from human steps relevant to the action point. */
function relevantHumanNarratives(humanJourneySteps: AgentStep[][], pointText: string, n = 3): string[] {
  const words = pointText.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  const hits: { text: string; score: number }[] = []
  for (const steps of humanJourneySteps) {
    for (const st of steps) {
      const haystack = `${st.url ?? ''} ${st.action_type ?? ''} ${JSON.stringify(st.action_details ?? {})}`.toLowerCase()
      const score = words.filter(w => haystack.includes(w)).length
      if (score === 0) continue
      const path = st.url ? (() => { try { return new URL(st.url).pathname } catch { return st.url } })() : ''
      const verb = ACTION_VERBS[st.action_type?.toLowerCase() ?? ''] ?? st.action_type ?? 'interacted'
      const detail = typeof st.action_details === 'object' && st.action_details !== null
        ? Object.values(st.action_details).filter(v => typeof v === 'string' && v.length > 1).slice(0, 1).join('')
        : ''
      const sentence = detail
        ? `User ${verb} "${String(detail).slice(0, 80)}" on ${path || 'the page'}`
        : `User ${verb} ${path || 'the page'}`
      hits.push({ text: sentence, score })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  return hits.filter(h => { if (seen.has(h.text)) return false; seen.add(h.text); return true }).slice(0, n).map(h => h.text)
}

const DIAGRAM_LABELS: Record<string, string> = {
  compare: 'AI vs Human',
  sankey: 'Journey Flow',
  horizon: 'Horizon Graph',
  heatmap: 'Page Heatmap',
  multiflow: 'All Flows',
  similarity: 'Journey Similarity',
  comparative: 'Comparative Analysis',
  insights: 'Insights',
  human_agg: 'Human Aggregate',
  policy: 'Policy Bot',
}

function IssueDetail({ point, idx, total, status, stats, agentJourneys, humanJourneySteps, ratingsSummary, onDone, onSkip, onPrev, onNext, onNavigateTo, compact = false }: {
  point: ActionPoint; idx: number; total: number; status: PointStatus
  stats: DiagramStats | null
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
  ratingsSummary: api.RatingsSummary | null
  onDone: () => void; onSkip: () => void; onPrev: () => void; onNext: () => void
  onNavigateTo: (tab: string, view?: string, note?: string, diagramRef?: DiagramRef) => void
  compact?: boolean
}) {
  const isPain = point.type === 'pain_point'
  const relevantRec = isPain && point.task.recommendations[point.ppIndex]
    ? toItem(point.task.recommendations[point.ppIndex] as ActionPointItem | string)
    : null
  const derivation = derivationSummary(point.task, stats)
  const rawDiagrams = point.item.diagrams ?? []

  // Auto-add a Horizon Graph chip for agent_gap / human_issue points when the
  // LLM hasn't already included one — the horizon graph always reveals timing
  // differences between AI and human journeys for these types.
  const diagrams: DiagramRef[] = (() => {
    if (!point.item.type || point.item.type === 'ux_issue') return rawDiagrams
    if (rawDiagrams.some(d => d.view === 'horizon')) return rawDiagrams
    const side = point.item.type === 'agent_gap' ? 'ai' : 'human'
    const autoHorizon: DiagramRef = {
      view: 'horizon',
      reason: `Shows when in the journey ${side === 'ai' ? 'AI agents' : 'human users'} are most active and how their timing differs`,
      highlight: { side },
      diagram_explanation: `Look at the ${side === 'ai' ? 'AI (teal)' : 'Human (rose)'} journey strips — the highlighted strips show when activity is concentrated across the journey for this action point.`,
    }
    return [...rawDiagrams, autoHorizon]
  })()

  const agentThoughts = useMemo(
    () => relevantAgentThoughts(agentJourneys, point.task.task_title, point.item.text),
    [agentJourneys, point.id],
  )
  const humanNarratives = useMemo(
    () => relevantHumanNarratives(humanJourneySteps, point.item.text),
    [humanJourneySteps, point.id],
  )
  const humanComments = ratingsSummary?.comments ?? []
  const hasHumanData = humanNarratives.length > 0 || humanComments.length > 0

  const [agentExplanation, setAgentExplanation] = useState<string | null>(point.item.agent_explanation ?? null)
  const [agentExpLoading, setAgentExpLoading] = useState(false)
  const [humanExplanation, setHumanExplanation] = useState<string | null>(point.item.human_explanation ?? null)
  const [humanExpLoading, setHumanExpLoading] = useState(false)

  useEffect(() => {
    // Use pre-generated explanations if available
    if (point.item.agent_explanation) {
      setAgentExplanation(point.item.agent_explanation)
      setAgentExpLoading(false)
    } else if (agentThoughts.length > 0) {
      setAgentExplanation(null)
      setAgentExpLoading(true)
      api.explainAgentPerspective(point.item.text, point.task.task_title, agentThoughts)
        .then(r => setAgentExplanation(r.explanation))
        .catch(() => setAgentExplanation(null))
        .finally(() => setAgentExpLoading(false))
    } else {
      setAgentExplanation(null)
    }

    if (point.item.human_explanation) {
      setHumanExplanation(point.item.human_explanation)
      setHumanExpLoading(false)
    } else if (hasHumanData) {
      setHumanExplanation(null)
      setHumanExpLoading(true)
      api.explainHuman(point.item.text, point.task.task_title, humanNarratives, humanComments, ratingsSummary)
        .then(r => setHumanExplanation(r.explanation))
        .catch(() => setHumanExplanation(null))
        .finally(() => setHumanExpLoading(false))
    } else {
      setHumanExplanation(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.id])

  const hasBullets = !!(point.item.agent_bullets?.length || point.item.human_bullets?.length)
  const hasPerspectives = !hasBullets && (agentThoughts.length > 0 || hasHumanData || !!point.item.agent_explanation || !!point.item.human_explanation)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: compact ? '14px 16px' : '16px 18px', gap: 12, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* Task */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'nowrap', minWidth: 0, borderBottom: '1.5px solid var(--border)', paddingBottom: 6 }}>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>Task:</span>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{point.task.task_title}</span>
      </div>

      {/* Issue text + type badge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{point.item.text}</p>
        {point.item.type && (() => {
          const badgeMap = {
            ux_issue:     { label: 'UX Issue',    bg: '#fee2e2', color: '#b91c1c' },
            agent_gap:    { label: 'Agent Gap',   bg: '#e0ecee', color: '#32494B' },
            human_issue:  { label: 'Human Issue', bg: '#f7d5e2', color: '#881342' },
          }
          const b = badgeMap[point.item.type]
          return b ? (
            <span style={{ alignSelf: 'flex-start', fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: b.bg, color: b.color }}>
              {b.label}
            </span>
          ) : null
        })()}
      </div>

      {compact && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--gray50)', border: '1px dashed var(--border)', color: 'var(--gray600)', fontSize: 'var(--fs-small)', lineHeight: 1.55 }}>
          The matching issue and fix markers are shown in the screenshot above.
        </div>
      )}

      {/* Suggested fix */}
      {relevantRec && (
        <div style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--brand-pale)', border: '1px solid var(--accent-soft)' }}>
          <Label>Suggested action</Label>
          <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--brand)', lineHeight: 1.55 }}>{relevantRec.text}</p>
        </div>
      )}

      {/* Human vs Agent behaviour bullets */}
      {(point.item.human_bullets?.length || point.item.agent_bullets?.length) ? (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '6px 10px', borderRight: '1px solid var(--border)', background: 'var(--gray50)' }}>
              <Label>Human Behaviour</Label>
            </div>
            <div style={{ padding: '6px 10px', background: 'var(--gray50)' }}>
              <Label>Agent Behaviour</Label>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <ul style={{ margin: 0, padding: '8px 10px 8px 22px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(point.item.human_bullets ?? []).map((b, i) => (
                <li key={i} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>{b}</li>
              ))}
              {!point.item.human_bullets?.length && (
                <li style={{ listStyle: 'none', fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data</li>
              )}
            </ul>
            <ul style={{ margin: 0, padding: '8px 10px 8px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(point.item.agent_bullets ?? []).map((b, i) => (
                <li key={i} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>{b}</li>
              ))}
              {!point.item.agent_bullets?.length && (
                <li style={{ listStyle: 'none', fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No agent data</li>
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Key finding */}
      {point.task.differences[0] && (
        <div>
          <Label>Key finding from analysis</Label>
          <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}>{point.task.differences[0]}</p>
        </div>
      )}

      {/* Perspectives: agent explanation + human explanation */}
      {hasPerspectives && (
        <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '6px 10px', borderRight: '1px solid var(--border)', background: 'var(--gray50)' }}>
              <Label>Explanation Agent</Label>
            </div>
            <div style={{ padding: '6px 10px', background: 'var(--gray50)' }}>
              <Label>Explanation Human</Label>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {/* Agent explanation */}
            <div style={{ padding: '8px 10px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start' }}>
              {agentThoughts.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No matching thoughts found</p>
              ) : agentExpLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                  <Spinner size={9} /> Analysing…
                </div>
              ) : agentExplanation ? (
                <div style={{ borderLeft: '2px solid var(--brand)', paddingLeft: 7 }}>
                  <RichText text={agentExplanation} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.55 }} />
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No matching thoughts found</p>
              )}
            </div>
            {/* Human explanation — AI-generated from journey steps + feedback */}
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'flex-start' }}>
              {!hasHumanData ? (
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data available</p>
              ) : humanExpLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                  <Spinner size={9} /> Analysing…
                </div>
              ) : humanExplanation ? (
                <div style={{ borderLeft: '2px solid #f59e0b', paddingLeft: 7 }}>
                  <RichText text={humanExplanation} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.55 }} />
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data available</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diagram chips — compact pill links */}
      {diagrams.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label>Verify in diagrams</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {diagrams.map((d) => {
              const label = DIAGRAM_LABELS[d.view] ?? d.view
              const note = `Action point: "${point.item.text.slice(0, 100)}${point.item.text.length > 100 ? '…' : ''}" · Task: ${point.task.task_title} · Evidence: ${d.reason}`
              const derivedSide = point.item.type === 'agent_gap' ? 'ai' : point.item.type === 'human_issue' ? 'human' : undefined
              const enriched: DiagramRef = {
                ...d,
                highlight: { ...d.highlight, side: d.highlight?.side ?? derivedSide },
              }
              return (
                <button
                  key={d.view}
                  title={d.reason}
                  onClick={() => onNavigateTo('views', d.view, note, enriched)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', height: 28, borderRadius: 99,
                    border: '1px solid var(--border)', background: 'var(--gray50)',
                    fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--brand)',
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-pale)'; e.currentTarget.style.borderColor = 'var(--brand)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--gray50)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  {label} ↗
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 10, borderTop: '1px solid var(--gray100)' }}>
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, marginRight: 4 }}>{idx + 1} / {total}</span>
        <button onClick={onDone} style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 700, cursor: 'pointer',
          border: 'none',
          background: status === 'done' ? '#2563eb22' : 'var(--brand)',
          color: status === 'done' ? 'var(--brand)' : '#fff',
        }}>{status === 'done' ? '✓ Done' : 'Mark done'}</button>
        <button onClick={onSkip} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer',
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: status === 'skipped' ? 'var(--gray400)' : 'var(--gray600)',
        }}>{status === 'skipped' ? 'Restore' : 'Skip'}</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          <button onClick={onPrev} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--gray700)',
          }}>← Prev</button>
          <button onClick={onNext} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--gray700)',
          }}>Next →</button>
        </div>
      </div>
    </div>
  )
}
