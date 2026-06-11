import { useState, useEffect, useRef, useMemo } from 'react'
import type { ComparativeAnalysis, ScreenshotMeta, JourneyResponse, DiagramRef } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'
import { type ActionPoint, derivePoints } from '../../lib/actionPoints'
import { debug } from '../../lib/debug'
import { useActionPointState } from './actionPoints/useActionPointState'
import { useAnnotationQueue } from './actionPoints/useAnnotationQueue'
import { IssueDetail } from './actionPoints/IssueDetail'
import { ScreenshotView } from './actionPoints/ScreenshotView'
import { Spinner } from './actionPoints/ui'

// Re-exported for DashboardPage and other consumers
export { GlyphDot } from './actionPoints/GlyphDot'

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
  onNavigateTo: (tab: string, view?: string, noteCtx?: { actionPointText: string; taskTitle: string; evidence: string }, diagramRef?: DiagramRef, pointText?: string) => void
  ratingsSummary: api.RatingsSummary | null
  compact?: boolean
  analysisRunId?: number
  /** Called whenever the action-point-specific screenshot or annotation changes.
   *  pending=true means selection/annotation is still in progress. */
  onScreenshotChange?: (screenshot: ScreenshotMeta | null, annotation: api.AnnotateResult | null, pending: boolean) => void
}

export default function ActionPointsList({
  siteId, compareAnalysis, compareLoading, compareError,
  onRunAnalysis, onRerunAnalysis, agentJourneyIds,
  agentJourneys, humanJourneySteps,
  taskFilter, tasks, onNavigateTo, ratingsSummary, compact = false,
  analysisRunId, onScreenshotChange,
}: Props) {
  const { statuses, setStatus, removedIds, removePointId, editedTexts, editText, editedRecs, editRec } = useActionPointState(siteId)
  const { selections, annotations, enqueueSelection, enqueueAnnotation, removePointCache } = useAnnotationQueue(siteId, analysisRunId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [allShots, setAllShots] = useState<ScreenshotMeta[]>([])
  const [shotsLoading, setShotsLoading] = useState(false)
  const shotsFetchKeyRef = useRef('')

  const journeyIdsKey = agentJourneyIds.join(',')
  useEffect(() => {
    if (agentJourneyIds.length === 0) return
    const fetchKey = journeyIdsKey + '|' + siteId
    if (shotsFetchKeyRef.current === fetchKey) return
    shotsFetchKeyRef.current = fetchKey
    setShotsLoading(true)

    const agentShotsP = Promise.all(
      agentJourneyIds.map(id => api.listJourneyScreenshots(id).catch(() => [] as api.ScreenshotMeta[]))
    ).then(r => r.flat())

    // Also include human session screenshots so the preselection has the full
    // picture — agents and humans often visit different pages for the same task.
    const humanShotsP = api.listSessions(siteId, 20)
      .then(sessions => Promise.all(
        sessions.map(s => api.listSessionScreenshots(s.id).catch(() => [] as api.ScreenshotMeta[]))
      ))
      .then(r => r.flat())
      .catch(() => [] as api.ScreenshotMeta[])

    Promise.all([agentShotsP, humanShotsP])
      .then(([agentShots, humanShots]) => {
        const flat = [...agentShots, ...humanShots].filter(sc => sc.ready)
        const seen = new Set<number>()
        const unique = flat.filter(sc => { if (seen.has(sc.id)) return false; seen.add(sc.id); return true })
        debug(
          `[CC:shots] loaded ${unique.length} unique screenshots (${agentShots.length} agent, ${humanShots.length} human):`,
          unique.map(s => `${s.id}:${s.path ?? '?'}`)
        )
        setAllShots(unique)
      })
      .finally(() => setShotsLoading(false))
  }, [agentJourneyIds, journeyIdsKey, siteId])

  const activeTaskTitle = taskFilter !== null ? (tasks.find(t => t.id === taskFilter)?.title ?? null) : null
  const points: ActionPoint[] = useMemo(() => {
    const rawPoints = compareAnalysis ? derivePoints(compareAnalysis) : []
    const filteredRaw = activeTaskTitle ? rawPoints.filter(p => p.task.task_title === activeTaskTitle) : rawPoints
    return filteredRaw
      .filter(p => !removedIds.has(p.id))
      .map(p => {
        const edited = editedTexts.get(p.id)
        return { ...p, item: edited ? { ...p.item, text: edited } : p.item, status: statuses[p.id] ?? 'open' }
      })
  }, [compareAnalysis, activeTaskTitle, removedIds, editedTexts, statuses])
  const pointIds = points.map(p => p.id).join(',')

  useEffect(() => {
    if (points.length > 0 && (selectedId === null || !points.find(p => p.id === selectedId)))
      setSelectedId(points[0].id)
  }, [points, activeTaskTitle, selectedId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const idx = points.findIndex(p => p.id === selectedId)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (idx > 0) setSelectedId(points[idx - 1].id)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (idx < points.length - 1) setSelectedId(points[idx + 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, points])

  // Return the text used to annotate the screenshot: the pain-point description itself
  // (with any user edit already applied via the points derivation).
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
      enqueueSelection(p.id, p.item.text, annTextFor(p), allShots.map(s => s.id), false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allShots.length, pointIds, analysisRunId])

  // Prioritise selected point: move it to front of queues
  useEffect(() => {
    if (!selectedId || allShots.length === 0) return
    const p = points.find(pt => pt.id === selectedId)
    if (!p) return
    if (selections.has(p.id)) {
      const shotId = selections.get(p.id) ?? null
      if (shotId !== null) enqueueAnnotation(p.id, shotId, annTextFor(p), true)
    } else {
      enqueueSelection(p.id, p.item.text, annTextFor(p), allShots.map(s => s.id), true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allShots.length, analysisRunId])

  function advance() {
    const idx = points.findIndex(p => p.id === selectedId)
    const next = points[idx + 1]
    if (next) setSelectedId(next.id)
  }
  function removePoint(id: string) {
    const idx = points.findIndex(p => p.id === id)
    const remaining = points.filter(p => p.id !== id)
    // remaining[idx] is the item that visually takes the removed point's slot
    const sibling = remaining[idx] ?? remaining[idx - 1]
    removePointId(id)
    removePointCache(id)
    setSelectedId(sibling?.id ?? null)
  }
  function handleEditText(id: string, text: string) {
    editText(id, text)
    // Text drives screenshot selection + annotation — invalidate so both re-run
    removePointCache(id)
  }

  const selected = points.find(p => p.id === selectedId) ?? null
  const openCount = points.filter(p => (statuses[p.id] ?? 'open') === 'open').length

  // Compute the exact screenshot + annotation for the currently selected point.
  // Using these as effect deps means the callback fires only when THIS point's
  // data changes — not on every unrelated annotation completing.
  const selectedShotId = selected ? (selections.get(selected.id) ?? null) : null
  // Memoize to keep the fallback object reference stable — without this, a new
  // fallback object is created on every render when allShots.find misses (e.g.
  // during initial load), causing the onScreenshotChange effect to fire in a loop.
  const selectedSc = useMemo(
    () => selectedShotId !== null
      ? (allShots.find(s => s.id === selectedShotId) ?? { id: selectedShotId, path: null, trigger: 'click', action_id: null, created_at_ms: null, ready: true })
      : null,
    [selectedShotId, allShots],
  )
  const selectedAnn = (selected && selectedShotId !== null)
    ? (annotations.get(`${selected.id}:${selectedShotId}`) ?? null)
    : null
  // pending = selection hasn't completed yet, OR screenshot found but annotation still running
  const selectedPending = selected
    ? (!selections.has(selected.id) || (selectedShotId !== null && !annotations.has(`${selected.id}:${selectedShotId}`)))
    : false

  useEffect(() => {
    debug(
      `[CC:cb] onScreenshotChange | sc: ${selectedSc?.id ?? 'null'} | ann: ${selectedAnn ? `found=${selectedAnn.found} pts=${selectedAnn.points.length}` : 'null'} | pending: ${selectedPending}`
    )
    onScreenshotChange?.(selectedSc, selectedAnn, selectedPending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSc, selectedAnn, selectedPending])

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

        <button
          onClick={() => {
            if (compareLoading) {
              if (window.confirm('Analysis is still running. Start over from scratch?')) onRerunAnalysis()
            } else {
              onRerunAnalysis()
            }
          }}
          title="Re-run the comparative analysis from scratch"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '3px 10px', borderRadius: 99, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--brand)', fontSize: 'var(--fs-small)',
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          {compareLoading ? <><Spinner size={9} /> Analysing…</> : '↻ Re-run'}
        </button>

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
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '55% 1fr', flex: 1, minHeight: 0, overflow: 'visible' }}>

          {!compact && (() => {
            const rawShotId = selections.get(selected.id)  // undefined = not yet selected, null = no match
            const shotId = rawShotId ?? null
            const noMatch = selections.has(selected.id) && shotId === null
            const sc = shotId !== null
              ? (allShots.find(s => s.id === shotId) ?? { id: shotId, path: null, trigger: 'click', action_id: null, created_at_ms: null, ready: true })
              : null
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
            agentJourneys={agentJourneys}
            humanJourneySteps={humanJourneySteps}
            ratingsSummary={ratingsSummary}
            onDone={() => { const was = (statuses[selected.id] ?? 'open') === 'done'; setStatus(selected.id, was ? 'open' : 'done'); if (!was) advance() }}
            onSkip={() => { const was = (statuses[selected.id] ?? 'open') === 'skipped'; setStatus(selected.id, was ? 'open' : 'skipped'); if (!was) advance() }}
            onPrev={() => { const i = points.findIndex(p => p.id === selected.id); if (i > 0) setSelectedId(points[i - 1].id) }}
            onNext={() => { const i = points.findIndex(p => p.id === selected.id); if (i < points.length - 1) setSelectedId(points[i + 1].id) }}
            onRemove={() => removePoint(selected.id)}
            onEditText={(text) => handleEditText(selected.id, text)}
            onEditRec={(text) => editRec(selected.id, text)}
            editedRecText={editedRecs.get(selected.id)}
            onNavigateTo={onNavigateTo}
            compact={compact}
          />
        </div>
      )}
    </div>
  )
}
