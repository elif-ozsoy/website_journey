import { useRef, useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import type { AgentStep } from '../agent/agentTypes'

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_W    = 240
const NODE_H    = 174
const GAP_X     = 84
const PAD_X     = 96
const LANE_GAP  = 66
const Y_TOP     = 34
const Y_MID     = Y_TOP + NODE_H + LANE_GAP
const Y_BOT     = Y_MID + NODE_H + LANE_GAP
const Y_PREV    = Y_BOT + NODE_H + LANE_GAP
const CANVAS_H_3 = Y_BOT  + NODE_H + 52
const CANVAS_H_4 = Y_PREV + NODE_H + 52

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2.5

const HUMAN_COLOR = '#881342'
const AI_COLOR    = '#32494B'
const PREV_COLOR  = '#6b7280'

// Hamming threshold for "same state": ≤12 bits differ out of 256 (≈95% similarity)
const HAMMING_THRESHOLD = 12

// ── Image helpers ─────────────────────────────────────────────────────────────
function stepSrc(step: AgentStep): string | null {
  if (step.screenshot_url) return step.screenshot_url
  if (step.screenshot_base64 && step.screenshot_base64.length > 10)
    return `data:image/png;base64,${step.screenshot_base64}`
  return null
}

function hasSrc(step: AgentStep): boolean {
  return !!(step.screenshot_url || (step.screenshot_base64 && step.screenshot_base64.length > 10))
}

// ── Perceptual hash (16×16 average hash → 256-bit string) ────────────────────
async function computePerceptualHash(src: string): Promise<string> {
  return new Promise(resolve => {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 16; canvas.height = 16
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(''); return }
          ctx.drawImage(img, 0, 0, 16, 16)
          const d = ctx.getImageData(0, 0, 16, 16).data
          const px: number[] = []
          for (let i = 0; i < d.length; i += 4)
            px.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000)
          const avg = px.reduce((a, b) => a + b, 0) / px.length
          resolve(px.map(p => (p >= avg ? '1' : '0')).join(''))
        } catch { resolve('') }
      }
      img.onerror = () => resolve('')
      img.src = src
    } catch { resolve('') }
  })
}

function hammingDist(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

// Assign each step a canonical cluster ID. Steps whose screenshots are ≥95%
// similar get the same ID. We process human + AI steps together so that
// matching states across both trajectories receive the same cluster ID.
function clusterSteps(
  allSteps: AgentStep[],
  hashMap: Map<string, string>,
): Map<AgentStep, string> {
  const result = new Map<AgentStep, string>()
  const representatives: Array<{ hash: string; id: string }> = []
  let fallbackIdx = 0

  for (const step of allSteps) {
    const src = stepSrc(step)
    if (!src) continue
    const hash = hashMap.get(src)
    if (!hash) {
      // Image failed to load (e.g. file missing after pod restart) — give the step
      // a unique cluster so it still appears in the layout without cross-matching.
      result.set(step, `f${fallbackIdx++}`)
      continue
    }

    let found = false
    for (const rep of representatives) {
      if (hammingDist(hash, rep.hash) <= HAMMING_THRESHOLD) {
        result.set(step, rep.id)
        found = true
        break
      }
    }
    if (!found) {
      const id = `c${representatives.length}`
      representatives.push({ hash, id })
      result.set(step, id)
    }
  }
  return result
}

// ── LCS on cluster IDs ────────────────────────────────────────────────────────
function lcs(a: string[], b: string[]): [number, number][] {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
  const pairs: [number, number][] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { pairs.unshift([i - 1, j - 1]); i--; j-- }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--
    else j--
  }
  return pairs
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Lane = 'human' | 'shared' | 'ai' | 'prev'

interface LayoutNode {
  id: string
  col: number
  lane: Lane
  src: string | null
  actionLabel: string
  humanStep?: AgentStep
  aiStep?: AgentStep
  humanStepsAll?: AgentStep[]   // all steps collapsed into this node (consecutive run)
  aiStepsAll?: AgentStep[]
  clusterId?: string
  isLoop?: boolean
  loopCount?: number            // total times this state was visited in this lane
}

interface LayoutEdge { fromId: string; toId: string; color: string }

// ── Collapse consecutive same-cluster steps into a single run ─────────────────
type StepRun = { repr: AgentStep; all: AgentStep[]; cid: string }

function collapseRuns(steps: AgentStep[], clusterMap: Map<AgentStep, string>): StepRun[] {
  const runs: StepRun[] = []
  for (const s of steps) {
    const cid = clusterMap.get(s)
    if (!cid) continue
    const last = runs[runs.length - 1]
    if (last && last.cid === cid) {
      last.all.push(s)
    } else {
      runs.push({ repr: s, all: [s], cid })
    }
  }
  return runs
}

// ── Layout builder ────────────────────────────────────────────────────────────
function buildLayout(
  humanSteps: AgentStep[],
  aiSteps: AgentStep[],
  hashMap: Map<string, string>,
  prevSteps?: AgentStep[],
) {
  const h = humanSteps.filter(hasSrc)
  const a = aiSteps.filter(hasSrc)

  const clusterMap = clusterSteps([...h, ...a], hashMap)

  // Collapse consecutive same-cluster steps so the canvas shows 1 card per run
  const hRuns = collapseRuns(h, clusterMap)
  const aRuns = collapseRuns(a, clusterMap)

  const hCluster = hRuns.map(r => r.cid)
  const aCluster = aRuns.map(r => r.cid)
  const lcsAligned = lcs(hCluster, aCluster)

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []

  const sentinels: [number, number][] = [[-1, -1], ...lcsAligned, [hRuns.length, aRuns.length]]

  let col = 0
  let prevHumanId: string | null = null
  let prevAiId: string | null = null

  for (let si = 1; si < sentinels.length; si++) {
    const [prevH, prevA] = sentinels[si - 1]
    const [curH, curA]   = sentinels[si]
    const isLast = si === sentinels.length - 1

    const hSeg = hRuns.slice(prevH + 1, curH)
    const aSeg = aRuns.slice(prevA + 1, curA)
    const segLen = Math.max(hSeg.length, aSeg.length)

    for (let i = 0; i < hSeg.length; i++) {
      const run = hSeg[i]
      const id = `h-${prevH + 1 + i}`
      nodes.push({
        id, col: col + i, lane: 'human',
        src: stepSrc(run.repr),
        actionLabel: run.repr.action_type.replace(/_/g, ' '),
        humanStep: run.repr,
        humanStepsAll: run.all,
        clusterId: run.cid,
        isLoop: run.all.length > 1,
        loopCount: run.all.length > 1 ? run.all.length : undefined,
      })
      const fromId = i === 0 ? prevHumanId : `h-${prevH + i}`
      if (fromId) edges.push({ fromId, toId: id, color: HUMAN_COLOR })
    }
    if (hSeg.length > 0) prevHumanId = `h-${prevH + hSeg.length}`

    for (let i = 0; i < aSeg.length; i++) {
      const run = aSeg[i]
      const id = `a-${prevA + 1 + i}`
      nodes.push({
        id, col: col + i, lane: 'ai',
        src: stepSrc(run.repr),
        actionLabel: run.repr.action_type.replace(/_/g, ' '),
        aiStep: run.repr,
        aiStepsAll: run.all,
        clusterId: run.cid,
        isLoop: run.all.length > 1,
        loopCount: run.all.length > 1 ? run.all.length : undefined,
      })
      const fromId = i === 0 ? prevAiId : `a-${prevA + i}`
      if (fromId) edges.push({ fromId, toId: id, color: AI_COLOR })
    }
    if (aSeg.length > 0) prevAiId = `a-${prevA + aSeg.length}`

    col += segLen

    if (!isLast) {
      const hRun = hRuns[curH]
      const aRun = aRuns[curA]
      const id = `shared-${curH}-${curA}`
      nodes.push({
        id, col, lane: 'shared',
        src: stepSrc(hRun.repr),
        actionLabel: hRun.repr.action_type.replace(/_/g, ' '),
        humanStep: hRun.repr,
        humanStepsAll: hRun.all,
        aiStep: aRun.repr,
        aiStepsAll: aRun.all,
        clusterId: hRun.cid,
      })
      if (prevHumanId) edges.push({ fromId: prevHumanId, toId: id, color: HUMAN_COLOR })
      if (prevAiId)    edges.push({ fromId: prevAiId,    toId: id, color: AI_COLOR })
      prevHumanId = id
      prevAiId    = id
      col++
    }
  }

  // Prev policy: linear sequence, no LCS alignment with human/ai
  if (prevSteps && prevSteps.length > 0) {
    const p = prevSteps.filter(hasSrc)
    const prevClusterMap = clusterSteps(p, hashMap)
    const pRuns = collapseRuns(p, prevClusterMap)
    let prevPrevId: string | null = null
    pRuns.forEach((run, i) => {
      const id = `prev-${i}`
      nodes.push({
        id, col: i, lane: 'prev',
        src: stepSrc(run.repr),
        actionLabel: run.repr.action_type.replace(/_/g, ' '),
        humanStep: run.repr,
        humanStepsAll: run.all,
        clusterId: run.cid,
        isLoop: run.all.length > 1,
        loopCount: run.all.length > 1 ? run.all.length : undefined,
      })
      if (prevPrevId) edges.push({ fromId: prevPrevId, toId: id, color: PREV_COLOR })
      prevPrevId = id
    })
    col = Math.max(col, pRuns.length)
  }

  // Detect non-consecutive loops: same clusterId+lane at multiple positions
  // Count total step visits and node positions per cluster+lane
  const laneClusterNodeCount = new Map<string, number>()
  const laneClusterTotalSteps = new Map<string, number>()
  for (const n of nodes) {
    if (!n.clusterId) continue
    const key = `${n.lane}:${n.clusterId}`
    laneClusterNodeCount.set(key, (laneClusterNodeCount.get(key) ?? 0) + 1)
    const visits = n.lane === 'human'
      ? (n.humanStepsAll?.length ?? 1)
      : n.lane === 'ai'
        ? (n.aiStepsAll?.length ?? 1)
        : Math.max(n.humanStepsAll?.length ?? 1, n.aiStepsAll?.length ?? 1)
    laneClusterTotalSteps.set(key, (laneClusterTotalSteps.get(key) ?? 0) + visits)
  }
  for (const n of nodes) {
    if (!n.clusterId) continue
    const key = `${n.lane}:${n.clusterId}`
    const nodeCount = laneClusterNodeCount.get(key) ?? 1
    const totalSteps = laneClusterTotalSteps.get(key) ?? 1
    if (n.isLoop || nodeCount > 1 || totalSteps > 1) {
      n.isLoop = true
      n.loopCount = totalSteps
    }
  }

  return { nodes, edges, totalCols: col }
}

// ── Loop attribution ─────────────────────────────────────────────────────────
// For human/ai nodes the lane already tells us who looped.
// For shared nodes we compare actual step counts on each side.
function loopAttribution(node: LayoutNode): { who: string; count: number } {
  if (node.lane === 'human') return { who: 'Human', count: node.loopCount ?? 1 }
  if (node.lane === 'ai')    return { who: 'AI',    count: node.loopCount ?? 1 }
  if (node.lane === 'prev')  return { who: 'Prev',  count: node.loopCount ?? 1 }
  const hV = node.humanStepsAll?.length ?? 1
  const aV = node.aiStepsAll?.length ?? 1
  if (hV > 1 && aV > 1) return { who: 'Both',  count: Math.max(hV, aV) }
  if (aV > 1)           return { who: 'AI',    count: aV }
  if (hV > 1)           return { who: 'Human', count: hV }
  return { who: 'Both', count: node.loopCount ?? 1 }
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function nodeX(col: number)  { return PAD_X + col * (NODE_W + GAP_X) }
function nodeY(lane: Lane)   {
  if (lane === 'human')  return Y_TOP
  if (lane === 'shared') return Y_MID
  if (lane === 'prev')   return Y_PREV
  return Y_BOT
}
function nodeCy(lane: Lane)  { return nodeY(lane) + NODE_H / 2 }
function canvasWidth(cols: number) { return 2 * PAD_X + cols * NODE_W + Math.max(0, cols - 1) * GAP_X }

function arrowPath(fromCol: number, fromLane: Lane, toCol: number, toLane: Lane): string {
  const x1 = nodeX(fromCol) + NODE_W, y1 = nodeCy(fromLane)
  const x2 = nodeX(toCol),            y2 = nodeCy(toLane)
  const cx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  humanFlow: AgentStep[] | null
  aiFlow: AgentStep[] | null
  prevFlow?: AgentStep[] | null
  showHuman?: boolean
  showAi?: boolean
  showPrev?: boolean
  hasPrevVersion?: boolean
  prevLabel?: string
  humanLoading?: boolean
  aiLoading?: boolean
  prevLoading?: boolean
  humanError?: string | null
  aiError?: string | null
  prevError?: string | null
  humanStatus?: string
  aiStatus?: string
  prevStatus?: string
  taskTitle?: string | null
  onRunHuman?: () => void
  onStopHuman?: () => void
  onRunAi?: () => void
  onStopAi?: () => void
  onRunPrev?: () => void
  onStopPrev?: () => void
  rightControl?: ReactNode
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MergedPolicyFlowMap({
  humanFlow, aiFlow, prevFlow = null,
  showHuman = true, showAi = true, showPrev = true,
  hasPrevVersion = false, prevLabel = 'Prev Policy',
  humanLoading = false, aiLoading = false, prevLoading = false,
  humanError = null, aiError = null, prevError = null,
  humanStatus = '', aiStatus = '', prevStatus = '',
  taskTitle = null,
  onRunHuman, onStopHuman, onRunAi, onStopAi, onRunPrev, onStopPrev,
  rightControl,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panX, setPanX] = useState(60)
  const [panY, setPanY] = useState(40)
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const dragRef    = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const wasDragRef = useRef(false)
  const wheelRef   = useRef<((e: WheelEvent) => void) | null>(null)

  // ── Hash computation ──────────────────────────────────────────────────────
  const [hashMap, setHashMap]       = useState<Map<string, string>>(new Map())
  const [hashesReady, setHashesReady] = useState(false)

  // Collect all unique image sources from all flows
  const allStepsList = useMemo(() => [
    ...(humanFlow ?? []).filter(hasSrc),
    ...(aiFlow ?? []).filter(hasSrc),
    ...(prevFlow ?? []).filter(hasSrc),
  ], [humanFlow, aiFlow, prevFlow])

  useEffect(() => {
    const srcs = [...new Set(allStepsList.map(s => stepSrc(s)).filter((s): s is string => !!s))]
    if (srcs.length === 0) { setHashMap(new Map()); setHashesReady(true); return }
    let cancelled = false
    setHashesReady(false)
    Promise.all(srcs.map(async src => [src, await computePerceptualHash(src)] as const))
      .then(results => {
        if (cancelled) return
        setHashMap(new Map(results.filter(([, h]) => h.length > 0)))
        setHashesReady(true)
      })
    return () => { cancelled = true }
  }, [allStepsList]) // re-run only when actual step list changes

  // Flows filtered by visibility toggles
  const visHumanFlow = showHuman ? humanFlow : null
  const visAiFlow    = showAi    ? aiFlow    : null
  const visPrevFlow  = showPrev  ? prevFlow  : null

  const hasPrevLane = !!(visPrevFlow && visPrevFlow.length > 0)
  const CANVAS_H = hasPrevLane ? CANVAS_H_4 : CANVAS_H_3

  // ── Layout ────────────────────────────────────────────────────────────────
  const { nodes, edges, totalCols } = useMemo(() => {
    if (!hashesReady) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[], totalCols: 0 }
    return buildLayout(visHumanFlow ?? [], visAiFlow ?? [], hashMap, visPrevFlow ?? undefined)
  }, [visHumanFlow, visAiFlow, visPrevFlow, hashMap, hashesReady])

  const nodeById = useMemo(() => {
    const m = new Map<string, LayoutNode>()
    nodes.forEach(n => m.set(n.id, n))
    return m
  }, [nodes])

  // Sorted for modal navigation: by col, then lane order (shared → human → ai)
  const laneOrder = (l: Lane) => l === 'shared' ? 0 : l === 'human' ? 1 : 2
  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.col !== b.col ? a.col - b.col : laneOrder(a.lane) - laneOrder(b.lane)),
    [nodes],
  )

  // Unique sorted nodes: deduplicate loops so step counter treats revisits as 1 step
  const uniqueSortedNodes = useMemo(() => {
    const seen = new Set<string>()
    return sortedNodes.filter(n => {
      const key = n.clusterId ? `${n.lane}:${n.clusterId}` : n.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [sortedNodes])

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null

  // Unique index for the step counter (loop revisits map back to first occurrence)
  const selectedUniqueIdx = useMemo(() => {
    if (!selectedNode) return -1
    const key = selectedNode.clusterId ? `${selectedNode.lane}:${selectedNode.clusterId}` : selectedNode.id
    return uniqueSortedNodes.findIndex(n => (n.clusterId ? `${n.lane}:${n.clusterId}` : n.id) === key)
  }, [selectedNode, uniqueSortedNodes])

  // Edge-based adjacency for diverge/converge navigation
  const { forwardMap, backwardMap } = useMemo(() => {
    const fwd = new Map<string, string[]>()
    const bwd = new Map<string, string[]>()
    edges.forEach(e => {
      if (!fwd.has(e.fromId)) fwd.set(e.fromId, [])
      fwd.get(e.fromId)!.push(e.toId)
      if (!bwd.has(e.toId)) bwd.set(e.toId, [])
      bwd.get(e.toId)!.push(e.fromId)
    })
    return { forwardMap: fwd, backwardMap: bwd }
  }, [edges])

  // Deduplicate by node ID: shared→shared edges are emitted twice (one per color) but
  // should navigate directly without showing the choice panel.
  function dedup(nodes: (LayoutNode | undefined)[]): LayoutNode[] {
    const seen = new Set<string>()
    return nodes.filter((n): n is LayoutNode => !!n && !seen.has(n.id) && (seen.add(n.id), true))
  }

  const nextNodes = useMemo(
    () => selectedNode ? dedup((forwardMap.get(selectedNode.id)  ?? []).map(id => nodeById.get(id))) : [],
    [selectedNode, forwardMap, nodeById],
  )
  const prevNodes = useMemo(
    () => selectedNode ? dedup((backwardMap.get(selectedNode.id) ?? []).map(id => nodeById.get(id))) : [],
    [selectedNode, backwardMap, nodeById],
  )

  const totalW = useMemo(() => canvasWidth(totalCols), [totalCols])
  const SVG_W  = Math.max(totalW, 800)

  // Fit view on layout change
  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const s = Math.min(Math.max(Math.min((width - 80) / SVG_W, (height - 120) / CANVAS_H), MIN_ZOOM), 1)
    setPanX((width  - SVG_W   * s) / 2)
    setPanY((height - CANVAS_H * s) / 2)
    setZoom(s)
  }, [nodes.length, SVG_W, CANVAS_H])

  // Non-passive wheel for zoom
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 0.9
    const rect   = containerRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    setZoom(pz => {
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pz * factor))
      const r  = nz / pz
      setPanX(px => mx - (mx - px) * r)
      setPanY(py => my - (my - py) * r)
      return nz
    })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const h = (e: WheelEvent) => wheelRef.current?.(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [hashesReady])

  const fitView = useCallback(() => {
    if (!containerRef.current) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const s = Math.min(Math.max(Math.min((width - 80) / SVG_W, (height - 120) / CANVAS_H), MIN_ZOOM), 1)
    setPanX((width  - SVG_W   * s) / 2)
    setPanY((height - CANVAS_H * s) / 2)
    setZoom(s)
  }, [SVG_W, CANVAS_H])


  const isLoading = humanLoading || aiLoading || prevLoading
  const isEmpty   = !visHumanFlow?.length && !visAiFlow?.length && !visPrevFlow?.length && !isLoading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, flexWrap: 'wrap' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: HUMAN_COLOR, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: HUMAN_COLOR }}>Human (steered AI)</span>
          {humanLoading
            ? <button onClick={onStopHuman} style={btnStyle(HUMAN_COLOR)}>Stop</button>
            : onRunHuman && <button onClick={onRunHuman} disabled={!taskTitle} style={btnStyle(HUMAN_COLOR, !taskTitle)}>{humanFlow?.length ? 'Re-run' : 'Run'}</button>
          }
          {(humanStatus || humanError) && (
            <span style={{ fontSize: 'var(--fs-small)', color: humanError ? 'var(--red)' : '#881342' }}>
              {humanLoading && <span className="inline-spinner" style={{ marginRight: 4 }} />}
              {humanError ?? humanStatus}
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: AI_COLOR, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: AI_COLOR }}>AI</span>
          {aiLoading
            ? <button onClick={onStopAi} style={btnStyle(AI_COLOR)}>Stop</button>
            : onRunAi && <button onClick={onRunAi} disabled={!taskTitle || !humanFlow?.length} style={btnStyle(AI_COLOR, !taskTitle || !humanFlow?.length)}>Run</button>
          }
          {(aiStatus || aiError) && (
            <span style={{ fontSize: 'var(--fs-small)', color: aiError ? 'var(--red)' : AI_COLOR }}>
              {aiLoading && <span className="inline-spinner" style={{ marginRight: 4 }} />}
              {aiError ?? aiStatus}
            </span>
          )}
        </div>

        {hasPrevVersion && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: PREV_COLOR, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: PREV_COLOR }}>{prevLabel}</span>
              {prevLoading
                ? onStopPrev && <button onClick={onStopPrev} style={btnStyle(PREV_COLOR)}>Stop</button>
                : onRunPrev && <button onClick={onRunPrev} disabled={!taskTitle} style={btnStyle(PREV_COLOR, !taskTitle)}>{prevFlow?.length ? 'Re-run' : 'Run'}</button>
              }
              {(prevStatus || prevError) && (
                <span style={{ fontSize: 'var(--fs-small)', color: prevError ? 'var(--red)' : PREV_COLOR }}>
                  {prevLoading && <span className="inline-spinner" style={{ marginRight: 4 }} />}
                  {prevError ?? prevStatus}
                </span>
              )}
            </div>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{rightControl}</div>
      </div>

      {/* ── Canvas ── */}
      {isEmpty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 'var(--fs-headline)' }}>🔀</div>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-secondary)' }}>No runs yet</div>
          <div style={{ fontSize: 'var(--fs-small)', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
            Click <strong>Run</strong> on either policy to launch a policy bot and see the merged trajectory diagram.
          </div>
        </div>
      ) : !hashesReady ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-body)' }}>
          <span className="inline-spinner" />
          Analysing screenshots…
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', background: 'var(--bg)' }}
          onMouseDown={e => {
            if (e.button !== 0) return
            e.preventDefault()
            wasDragRef.current = false
            dragRef.current = { sx: e.clientX, sy: e.clientY, px: panX, py: panY }
            setIsDragging(true)
          }}
          onMouseMove={e => {
            if (!dragRef.current) return
            const dx = e.clientX - dragRef.current.sx, dy = e.clientY - dragRef.current.sy
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragRef.current = true
            setPanX(dragRef.current.px + dx)
            setPanY(dragRef.current.py + dy)
          }}
          onMouseUp={() => { dragRef.current = null; setIsDragging(false) }}
          onMouseLeave={() => { dragRef.current = null; setIsDragging(false) }}
        >
          {/* Dot grid */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${panX % (24 * zoom)}px ${panY % (24 * zoom)}px`,
          }} />

          {/* Transformed canvas */}
          <div style={{
            position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            width: SVG_W, height: CANVAS_H, willChange: 'transform',
          }}>
            {/* SVG arrows */}
            <svg style={{ position: 'absolute', inset: 0, width: SVG_W, height: CANVAS_H, overflow: 'visible', pointerEvents: 'none' }}>
              <defs>
                {([['human', HUMAN_COLOR], ['ai', AI_COLOR], ['prev', PREV_COLOR], ['start', '#64748b']] as const).map(([id, fill]) => (
                  <marker key={id} id={`arr-${id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0 0 L8 4 L0 8Z" fill={fill} />
                  </marker>
                ))}
              </defs>

              {/* START → first column */}
              {nodes.length > 0 && (() => {
                // Non-prev nodes share the same LCS column space; prev nodes start at col 0 independently
                const mainNodes = nodes.filter(n => n.lane !== 'prev')
                const firstCol   = mainNodes.length > 0 ? mainNodes.reduce((m, n) => Math.min(m, n.col), Infinity) : Infinity
                const firstNodes = mainNodes.filter(n => n.col === firstCol)
                const prevFirstNode = nodes.find(n => n.lane === 'prev')
                const startX = nodeX(firstCol !== Infinity ? firstCol : 0) - 26
                return [
                  ...firstNodes.map(fn => {
                    const color    = fn.lane === 'shared' ? '#64748b' : fn.lane === 'human' ? HUMAN_COLOR : AI_COLOR
                    const markerId = fn.lane === 'shared' ? 'start' : fn.lane === 'human' ? 'human' : 'ai'
                    return (
                      <line key={fn.id}
                        x1={startX} y1={nodeCy(fn.lane)}
                        x2={nodeX(firstCol) - 4} y2={nodeCy(fn.lane)}
                        stroke={color} strokeWidth="2.5" markerEnd={`url(#arr-${markerId})`}
                      />
                    )
                  }),
                  prevFirstNode && (
                    <line key="prev-start"
                      x1={nodeX(0) - 26} y1={nodeCy('prev')}
                      x2={nodeX(0) - 4}  y2={nodeCy('prev')}
                      stroke={PREV_COLOR} strokeWidth="2.5" markerEnd="url(#arr-prev)"
                    />
                  ),
                ]
              })()}

              {/* Edges */}
              {edges.map((edge, i) => {
                const from = nodeById.get(edge.fromId)
                const to   = nodeById.get(edge.toId)
                if (!from || !to) return null
                const markerId = edge.color === HUMAN_COLOR ? 'human' : edge.color === PREV_COLOR ? 'prev' : 'ai'
                return (
                  <path key={i}
                    d={arrowPath(from.col, from.lane, to.col, to.lane)}
                    stroke={edge.color} strokeWidth="2.5" fill="none"
                    markerEnd={`url(#arr-${markerId})`}
                  />
                )
              })}

            </svg>

            {/* START pills */}
            {nodes.length > 0 && (() => {
              const mainNodes = nodes.filter(n => n.lane !== 'prev')
              const firstCol  = mainNodes.length > 0 ? mainNodes.reduce((m, n) => Math.min(m, n.col), Infinity) : -1
              const firstNode = firstCol >= 0 ? mainNodes.find(n => n.col === firstCol) : null
              const prevFirstNode = nodes.find(n => n.lane === 'prev')
              return (
                <>
                  {firstNode && (
                    <div style={{
                      position: 'absolute', left: nodeX(firstCol) - 74, top: nodeCy(firstNode.lane) - 15,
                      width: 60, height: 30, background: '#0f172a', color: '#fff',
                      borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 900, letterSpacing: '0.08em',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}>START</div>
                  )}
                  {prevFirstNode && (
                    <div style={{
                      position: 'absolute', left: nodeX(0) - 74, top: nodeCy('prev') - 15,
                      width: 60, height: 30, background: PREV_COLOR, color: '#fff',
                      borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 900, letterSpacing: '0.08em',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}>START</div>
                  )}
                </>
              )
            })()}

            {/* Nodes */}
            {nodes.map(node => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={node.id === selectedNodeId}
                onClick={() => { if (!wasDragRef.current) setSelectedNodeId(node.id) }}
              />
            ))}
          </div>

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10 }}>
            {([
              { label: '+', fn: () => setZoom(z => Math.min(MAX_ZOOM, z * 1.2)), title: 'Zoom in' },
              { label: '−', fn: () => setZoom(z => Math.max(MIN_ZOOM, z / 1.2)), title: 'Zoom out' },
              { label: '⊡', fn: fitView, title: 'Fit view' },
            ] as const).map(({ label, fn, title }) => (
              <button key={label} title={title} onClick={fn} style={{
                width: 32, height: 32, background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer',
                fontSize: 14, fontWeight: 700, color: '#475569',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{label}</button>
            ))}
          </div>

          {/* Running indicator */}
          {isLoading && (
            <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(255,255,255,0.93)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 'var(--fs-small)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="inline-spinner" />
              {humanLoading ? (humanStatus || 'Running human policy…') : (aiStatus || 'Running AI policy…')}
            </div>
          )}
        </div>
      )}

      {/* ── Step detail modal ── */}
      {selectedNode && (
        <NodeModal
          node={selectedNode}
          prevNodes={prevNodes}
          nextNodes={nextNodes}
          totalCount={uniqueSortedNodes.length}
          currentIdx={selectedUniqueIdx}
          onClose={() => setSelectedNodeId(null)}
          onNavigate={id => setSelectedNodeId(id)}
        />
      )}
    </div>
  )
}

// ── Node card ─────────────────────────────────────────────────────────────────
function NodeCard({ node, isSelected, onClick }: { node: LayoutNode; isSelected: boolean; onClick: () => void }) {
  const x = nodeX(node.col)
  const y = nodeY(node.lane)

  const borderColor = node.isLoop
    ? '#f59e0b'
    : node.lane === 'shared' ? '#a855f7' : node.lane === 'human' ? HUMAN_COLOR : node.lane === 'prev' ? PREV_COLOR : AI_COLOR
  const badgeLabel  = node.lane === 'shared' ? '⟷ shared' : node.lane === 'human' ? 'human' : node.lane === 'prev' ? 'prev' : 'AI'
  const badgeBg     = node.lane === 'shared'
    ? 'linear-gradient(135deg, #10b981, #3b82f6)'
    : node.lane === 'human' ? HUMAN_COLOR : node.lane === 'prev' ? PREV_COLOR : AI_COLOR

  const thumbH = NODE_H - 36

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', left: x, top: y, width: NODE_W, height: NODE_H,
        borderRadius: 12, overflow: 'hidden',
        border: `2px solid ${isSelected ? '#7c3aed' : borderColor}`,
        background: '#fff',
        boxShadow: isSelected ? `0 0 0 3px #7c3aed40, 0 8px 24px rgba(0,0,0,0.15)` : '0 2px 10px rgba(0,0,0,0.09)',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => {
        if (isSelected) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)'
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        if (isSelected) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.09)'
        el.style.transform = 'translateY(0)'
      }}
    >
      {/* Screenshot thumbnail */}
      <div style={{ width: '100%', height: thumbH, background: '#f1f5f9', overflow: 'hidden', position: 'relative' }}>
        {node.src
          ? <img src={node.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
          : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>No image</div>
        }
        <div style={{
          position: 'absolute', top: 6, left: 6,
          background: badgeBg, color: '#fff',
          borderRadius: 4, padding: '2px 7px',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }}>{badgeLabel}</div>
        {node.isLoop && (() => {
          const { who, count } = loopAttribution(node)
          return (
            <div style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(245,158,11,0.92)', color: '#fff',
              borderRadius: 4, padding: '2px 6px',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2v4h-4"/>
                <path d="M1 12v-4h4"/>
                <path d="M11.8 7a5 5 0 0 0-8.6-2.7L1 7"/>
                <path d="M2.2 7a5 5 0 0 0 8.6 2.7L13 7"/>
              </svg>
              {who} ×{count}
            </div>
          )
        })()}
      </div>
      {/* Footer */}
      <div style={{ height: 36, padding: '0 10px', display: 'flex', alignItems: 'center', borderTop: '1px solid #f1f5f9', background: '#fff', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: borderColor, textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.actionLabel}
        </span>
        <span style={{ fontSize: 9, color: '#94a3b8', flexShrink: 0 }}>click to expand</span>
      </div>
    </div>
  )
}

// ── Detail modal with diverge/converge path chooser ──────────────────────────
interface ModalProps {
  node: LayoutNode
  prevNodes: LayoutNode[]
  nextNodes: LayoutNode[]
  totalCount: number
  currentIdx: number
  onClose: () => void
  onNavigate: (id: string) => void
}

function NodeModal({ node, prevNodes, nextNodes, totalCount, currentIdx, onClose, onNavigate }: ModalProps) {
  const [choiceDir, setChoiceDir] = useState<'left' | 'right' | null>(null)
  const [choiceIdx, setChoiceIdx] = useState(0)

  // Reset choices when the node changes
  useEffect(() => { setChoiceDir(null); setChoiceIdx(0) }, [node.id])
  // Reset selection index when choice panel opens
  useEffect(() => { setChoiceIdx(0) }, [choiceDir])

  const handleNext = useCallback(() => {
    if (nextNodes.length === 0) return
    if (nextNodes.length === 1) { onNavigate(nextNodes[0].id) }
    else { setChoiceDir(d => d === 'right' ? null : 'right') }
  }, [nextNodes, onNavigate])

  const handlePrev = useCallback(() => {
    if (choiceDir === 'right') { setChoiceDir(null); return }
    if (prevNodes.length === 0) return
    if (prevNodes.length === 1) { onNavigate(prevNodes[0].id) }
    else { setChoiceDir(d => d === 'left' ? null : 'left') }
  }, [prevNodes, choiceDir, onNavigate])

  const confirmChoice = useCallback(() => {
    if (choiceDir === 'right') {
      const target = nextNodes[choiceIdx]
      if (target) { onNavigate(target.id); setChoiceDir(null) }
    } else if (choiceDir === 'left') {
      const target = prevNodes[choiceIdx]
      if (target) { onNavigate(target.id); setChoiceDir(null) }
    }
  }, [choiceDir, choiceIdx, nextNodes, prevNodes, onNavigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (choiceDir) {
        const nodes = choiceDir === 'right' ? nextNodes : prevNodes
        if (e.key === 'ArrowDown') { e.preventDefault(); setChoiceIdx(i => Math.min(i + 1, nodes.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setChoiceIdx(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter' || (e.key === 'ArrowRight' && choiceDir === 'right') || (e.key === 'ArrowLeft' && choiceDir === 'left')) {
          e.preventDefault(); confirmChoice()
        } else if (e.key === 'Escape') { e.preventDefault(); setChoiceDir(null) }
        return
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext() }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handlePrev() }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNext, handlePrev, confirmChoice, choiceDir, choiceIdx, nextNodes, prevNodes, onClose])

  const renderStep = (step: AgentStep, allSteps: AgentStep[] | undefined, label: string, color: string) => {
    const img = stepSrc(step)
    const messages = allSteps && allSteps.length > 0 ? allSteps : [step]
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '7px 14px', background: `${color}12`, borderBottom: `2px solid ${color}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color }}>{label}</span>
          {messages.length > 1 && (
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color, background: `${color}18`, borderRadius: 4, padding: '1px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2v4h-4"/><path d="M1 12v-4h4"/>
                <path d="M11.8 7a5 5 0 0 0-8.6-2.7L1 7"/><path d="M2.2 7a5 5 0 0 0 8.6 2.7L13 7"/>
              </svg>
              ×{messages.length} visits
            </span>
          )}
        </div>
        <div style={{ flex: 1, background: '#fff', overflow: 'hidden', position: 'relative', minHeight: 0 }}>
          {img
            ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} draggable={false} />
            : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>No screenshot</div>
          }
        </div>
        {/* Scrollable message history */}
        <div style={{ maxHeight: 160, overflowY: 'auto', borderTop: `1px solid ${color}30`, background: '#fafafa', flexShrink: 0 }}>
          {messages.map((s, idx) => {
            let spath = s.url
            try { spath = new URL(s.url).pathname || '/' } catch { /* ok */ }
            return (
              <div key={idx} style={{ padding: '7px 14px', borderBottom: idx < messages.length - 1 ? `1px solid ${color}14` : undefined }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  {messages.length > 1 && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: `${color}99`, flexShrink: 0, minWidth: 16 }}>#{idx + 1}</span>
                  )}
                  <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: '#374151' }}>{s.action_type.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 'var(--fs-small)', color: '#9ca3af', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{spath}</span>
                </div>
                {s.thought && (
                  <div style={{ fontSize: 'var(--fs-small)', color: '#6b7280', fontStyle: 'italic', lineHeight: 1.4, marginTop: 3 }}>
                    {s.thought}
                  </div>
                )}
                {s.next_goal && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: '#7c3aed', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      suggested
                    </span>
                    <span style={{ fontSize: 'var(--fs-small)', color: '#4c1d95', lineHeight: 1.4 }}>
                      {s.next_goal}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const isShared = node.lane === 'shared'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, gap: 14 }}
      onClick={() => { if (choiceDir) setChoiceDir(null); else onClose() }}
    >
      {/* Left choice panel (converge choices going back) */}
      {choiceDir === 'left' && (
        <ChoicePanel nodes={prevNodes} label="Go back to:" selectedIdx={choiceIdx} onClick={id => { onNavigate(id); setChoiceDir(null) }} />
      )}

      {/* Main modal */}
      <div
        style={{ background: '#fff', borderRadius: 18, boxShadow: '0 32px 80px rgba(0,0,0,0.38)', width: '100%', maxWidth: 'min(820px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button disabled={prevNodes.length === 0} onClick={handlePrev} title="Previous (←)" style={navBtnStyle(prevNodes.length === 0)}>←</button>
          <span style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>{currentIdx + 1} / {totalCount}</span>
          <button disabled={nextNodes.length === 0} onClick={handleNext} title="Next (→)" style={navBtnStyle(nextNodes.length === 0)}>→</button>

          <div style={{ flex: 1, fontSize: 'var(--fs-body)', fontWeight: 700, color: '#111827', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {isShared ? 'Shared State' : node.lane === 'human' ? 'Human Policy Step' : 'AI Policy Step'}
            {node.isLoop && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: '2px 8px' }}>
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2v4h-4"/><path d="M1 12v-4h4"/>
                  <path d="M11.8 7a5 5 0 0 0-8.6-2.7L1 7"/><path d="M2.2 7a5 5 0 0 0 8.6 2.7L13 7"/>
                </svg>
                {loopAttribution(node).who} loop · ×{loopAttribution(node).count}
              </span>
            )}
          </div>

          <span style={{ fontSize: 'var(--fs-small)', color: '#9ca3af', whiteSpace: 'nowrap' }}>{choiceDir ? '↑ ↓ to choose · Enter to confirm' : '← → to navigate'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 4px', marginLeft: 4 }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {isShared
            ? (node.aiStep ?? node.humanStep) && renderStep(
                (node.aiStep ?? node.humanStep)!,
                node.aiStepsAll ?? node.humanStepsAll,
                'Shared State', '#a855f7'
              )
            : <>
                {node.humanStep && renderStep(node.humanStep, node.humanStepsAll, 'Human Policy', HUMAN_COLOR)}
                {node.aiStep    && renderStep(node.aiStep,    node.aiStepsAll,    'AI Policy',    AI_COLOR)}
              </>
          }
        </div>
      </div>

      {/* Right choice panel (diverge choices going forward) */}
      {choiceDir === 'right' && (
        <ChoicePanel nodes={nextNodes} label="Choose path:" selectedIdx={choiceIdx} onClick={id => { onNavigate(id); setChoiceDir(null) }} />
      )}
    </div>
  )
}

// ── Branch choice panel ───────────────────────────────────────────────────────
function ChoicePanel({ nodes, label, selectedIdx, onClick }: { nodes: LayoutNode[]; label: string; selectedIdx: number; onClick: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 174, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', paddingLeft: 2 }}>{label}</div>
      {nodes.map((n, i) => {
        const color = n.lane === 'human' ? HUMAN_COLOR : n.lane === 'shared' ? '#a855f7' : n.lane === 'prev' ? PREV_COLOR : AI_COLOR
        const policyLabel = n.lane === 'human' ? 'Human Policy' : n.lane === 'shared' ? 'Shared' : n.lane === 'prev' ? 'Prev Policy' : 'AI Policy'
        const isActive = i === selectedIdx
        return (
          <div
            key={n.id}
            onClick={() => onClick(n.id)}
            style={{
              borderRadius: 12, overflow: 'hidden',
              border: `2.5px solid ${color}`,
              cursor: 'pointer', background: '#fff',
              boxShadow: isActive ? `0 0 0 3px ${color}80, 0 10px 32px rgba(0,0,0,0.4)` : '0 6px 24px rgba(0,0,0,0.28)',
              transform: isActive ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'scale(1.05)'; el.style.boxShadow = `0 0 0 3px ${color}80, 0 10px 32px rgba(0,0,0,0.4)` }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.transform = isActive ? 'scale(1.05)' : 'scale(1)'
              el.style.boxShadow = isActive ? `0 0 0 3px ${color}80, 0 10px 32px rgba(0,0,0,0.4)` : '0 6px 24px rgba(0,0,0,0.28)'
            }}
          >
            <div style={{ height: 106, background: '#f1f5f9', overflow: 'hidden' }}>
              {n.src
                ? <img src={n.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>No image</div>
              }
            </div>
            <div style={{ padding: '7px 10px', borderTop: `2px solid ${color}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{policyLabel}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.actionLabel}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '3px 10px',
    borderRadius: 6, border: `1px solid ${color}`,
    background: disabled ? 'transparent' : color,
    color: disabled ? color : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'opacity 0.15s',
  }
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, border: '1px solid #e5e7eb',
    background: disabled ? '#f9fafb' : '#fff',
    color: disabled ? '#d1d5db' : '#374151',
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: 700, fontSize: 14, flexShrink: 0,
    boxShadow: disabled ? 'none' : '0 1px 3px rgba(0,0,0,0.08)',
  }
}
