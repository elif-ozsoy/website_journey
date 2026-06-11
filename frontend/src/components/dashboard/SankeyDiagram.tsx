import { debug, debugWarn } from '../../lib/debug'
import { useRef, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { AGENT_COLOR, HUMAN_COLOR, SANKEY_MARGIN, pagePath, truncate } from '../../lib/sankeyShared'
import * as d3 from 'd3'
import { createPortal } from 'react-dom'
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey'
import type { AgentStep } from '../agent/agentTypes'
import type { CompareHighlight } from '../../lib/api'
import LinkedHorizonStrip, { type ActiveJourney } from './LinkedHorizonStrip'
import { actionSamples } from './horizonDensity'

/* ────────────────────────────────────────────────────────────────────────────
 *  Props
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  agentJourneys: AgentStep[][]
  humanJourneys?: AgentStep[][]
  agentLabels?: string[]
  humanLabels?: string[]
  onDivergencesChange?: (divergences: NodeDivergence[]) => void
  highlight?: CompareHighlight
  /* When true, dock a per-journey horizon strip beneath the diagram and switch
   * the click gesture to "pin" (double-click still opens the detail modal). */
  linkedMode?: boolean
  rightControl?: ReactNode
}

/* ── Color tokens ──
 * Important: use HEX, not CSS variables, here. d3 sets fill/stroke as SVG
 * attributes via .attr(), and `var(--accent)` does NOT resolve as an SVG
 * attribute value — the node ends up with no usable color. Plain hex works.
 * If you really want themed colors, switch these to .style('fill', ...) and
 * use real CSS classes — but hex keeps things simple and reliable.
 */

const AGENT_PALETTE = [
  '#0072B2',
  '#1a85c4',
  '#3398d6',
  '#4daae8',
  '#66b8f0',
  '#99d0f7',
]

const HUMAN_PALETTE = [
  '#E69F00',
  '#f0b31a',
  '#f5c840',
  '#f8d966',
  '#fae88c',
  '#fdf2c0',
]
function colorForJourney(kind: 'agent' | 'human', index: number): string {
  const palette = kind === 'agent' ? AGENT_PALETTE : HUMAN_PALETTE
  return palette[index % palette.length]
}
const TEXT_DARK   = '#334155'
const TEXT_MUTED  = '#94a3b8'
const TEXT_LABEL  = '#475569'
const BORDER      = '#e2e8f0'

const STEP_ACTION_COLORS: Record<string, string> = {
  click_element: '#185FA5',
  input_text:    '#059669',
  go_to_url:     '#d97706',
  scroll:        '#0891b2',
  go_back:       '#f43f5e',
  extract_content: '#7c3aed',
  done:          '#16a34a',
}

const DIM_OPACITY = 0.10
const NORMAL_OPACITY = 0.75
const HIGHLIGHT_OPACITY = 0.95
const MARGIN = SANKEY_MARGIN

function stepScreenshot(s: AgentStep): string | null {
  if (s.screenshot_url) return s.screenshot_url
  if (s.screenshot_base64) return `data:image/png;base64,${s.screenshot_base64}`
  return null
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Utilities
 * ────────────────────────────────────────────────────────────────────────── */

/* Short page path for prefixing node labels. */

/* Build a human-readable node label for a step, taking the action into account.
 * Examples:
 *   click → "click: Lehrer:innen »"
 *   go_to_url → "/lehrer (page)"
 *   scroll → "scrolled"
 *   input_text → "type: hello"
 */

/* Canonical action kinds. Both human-recorded steps and browser-use agent
 * steps get normalized to one of these. */
type CanonicalAction =
  | 'click' | 'input' | 'navigate' | 'scroll' | 'back'
  | 'extract' | 'wait' | 'key' | 'tab' | 'done' | 'other'

function canonicalAction(s: AgentStep): CanonicalAction | null {
  const a = (s.action_type ?? '').toLowerCase()
  if (!a || a === 'unknown') {
    // Some AGENT steps lack a top-level action_type but have action_details
    // with the real action key. Recover by re-running normalization against
    // a key from action_details — but only if it actually looks like an
    // action name. Otherwise human-recorder steps with metadata fields like
    // `path` or `timestamp` would be misclassified as actions.
    // @ts-ignore
    const det = s.action_details ?? {}
    if (det && typeof det === 'object') {
      const ACTION_KEY_PATTERNS = [
        /click/i, /input/i, /type/i, /fill/i, /scroll/i, /navigate/i,
        /go_to|goto|open_url/i, /back/i, /extract|read|get_content/i,
        /wait|sleep/i, /key|press/i, /tab/i, /done|finish|complete/i,
      ]
      const actionLikeKey = Object.keys(det).find(k =>
        ACTION_KEY_PATTERNS.some(p => p.test(k)))
      if (actionLikeKey) {
        return canonicalAction({ ...s, action_type: actionLikeKey } as AgentStep)
      }
    }
    return null
  }
  // Click family
  if (a.includes('click') || a === 'tap' || a === 'press') return 'click'
  // Input/type family
  if (a.includes('input') || a.includes('type') || a.includes('fill')) return 'input'
  // Navigation family
  if (a === 'go_to_url' || a.includes('navigate') || a === 'open_url' || a === 'goto') return 'navigate'
  // Scroll family
  if (a.includes('scroll')) return 'scroll'
  // Back/forward
  if (a.includes('back') || a === 'history_back') return 'back'
  // Extract/read
  if (a.includes('extract') || a.includes('read') || a.includes('get_content')) return 'extract'
  // Wait/pause
  if (a.includes('wait') || a === 'sleep') return 'wait'
  // Key press
  if (a.includes('key') || a === 'press_key') return 'key'
  // Tab manipulation
  if (a.includes('tab')) return 'tab'
  // Done/finish
  if (a === 'done' || a === 'finish' || a === 'complete') return 'done'
  return 'other'
}

/* Get the element text / target description from a step.
 * The human recorder may put it on top-level fields; the agent puts it in
 * action_details. We check both. */
function stepTargetText(s: AgentStep): string | undefined {
  // Human recorder fields
  const top =
    // @ts-ignore
    s.element_text ?? s.target_text ?? s.selector ?? s.aria_label
  if (top && String(top).trim()) return String(top).trim()
  // Agent action_details (browser-use puts payload here)
  // @ts-ignore
  const det = s.action_details ?? {}
  if (det && typeof det === 'object') {
    const candidates = [
      det.text, det.element_text, det.target_text, det.label,
      det.aria_label, det.selector, det.xpath, det.value,
    ].filter(Boolean) as string[]
    if (candidates.length > 0) return String(candidates[0]).trim()
  }
  /* Human-session fallback: the recorder stuffs the clicked element's
   * visible text into `thought`. AI agents use `thought` for free-text
   * reasoning AND populate `next_goal` — so we only treat `thought` as an
   * element label when `next_goal` is empty (i.e., this is almost certainly
   * a human step, not an AI step). */
  // @ts-ignore
  const thought: string | undefined = s.thought
  // @ts-ignore
  const nextGoal: string | undefined = s.next_goal
  if (thought && !nextGoal && thought.trim()) {
    return thought.trim()
  }
  return undefined
}

function stepInputValue(s: AgentStep): string | undefined {
  // @ts-ignore
  const top = s.value ?? s.input_text ?? s.text
  if (top) return String(top)
  // @ts-ignore
  const det = (s.action_details ?? {}) as Record<string, unknown>
  for (const k of ['text', 'value', 'input']) {
    const v = det[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

function stepNavTarget(s: AgentStep): string | undefined {
  // @ts-ignore
  const det = (s.action_details ?? {}) as Record<string, unknown>
  const u = det['url']
  if (typeof u === 'string' && u) return u
  return s.url || undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Milestone classification
 *
 *  Instead of one node per raw step, every step is mapped to a small set of
 *  milestones. The Sankey shows the journey from milestone to milestone. Link
 *  thickness encodes how many raw steps each run spent between two milestones,
 *  so AI's fast traversal and human's meandering can be compared side-by-side
 *  on the same graph.
 *
 *  Milestones (in conventional order, though journeys can skip any of them):
 *    start         : implicit first milestone for every journey
 *    nav           : a click on a short, nav-link-like label
 *    page          : an explicit go_to_url / page-change
 *    list-view     : a click on a list/index-style target
 *    detail-view   : a click on a long content label (item-in-list pattern)
 *    input         : an input_text / type action
 *    extract       : extract / read content
 *    done          : the done action, or last step of a journey
 *  Anything that doesn't fit cleanly is bucketed as 'other'.
 * ────────────────────────────────────────────────────────────────────────── */

type Milestone =
  | 'start' | 'nav' | 'page' | 'list-view' | 'detail-view'
  | 'input' | 'scroll' | 'extract'
  | 'done' | 'failed' | 'incomplete'
  | 'other'

const MILESTONE_ORDER: Record<Milestone, number> = {
  'start': 0, 'page': 1, 'nav': 2, 'list-view': 3, 'scroll': 4,
  'detail-view': 5, 'input': 6, 'extract': 7,
  'done': 8, 'failed': 9, 'incomplete': 10,
  'other': 11,
}

const MILESTONE_LABEL: Record<Milestone, string> = {
  'start': 'start',
  'nav': 'navigation click',
  'page': 'page load',
  'list-view': 'list view',
  'detail-view': 'detail / item',
  'input': 'input',
  'scroll': 'scrolled',
  'extract': 'extract data',
  'done': '✓ done',
  'failed': '⚠ failed',
  'incomplete': '… incomplete',
  'other': 'other',
}

/* Short codes for the pattern strip. */

/* Special colors for terminal milestones. Override nodeColor() and pattern-
 * chip background for these. */
const TERMINAL_COLORS: Partial<Record<Milestone, string>> = {
  'done':       '#15803d',   // deep green — readable label, not neon
  'failed':     '#b91c1c',   // deep red
  'incomplete': '#475569',
  'detail-view': '#4c3a6e',
  'nav':         '#4c3a6e',
  'scroll':      '#4c3a6e',
  'start':       '#4c3a6e',
  'page':        '#4c3a6e',
}

/* Heuristics — kept simple and explainable. These work well for the
 * teacher-list pattern in your test data and generalize reasonably to most
 * navigation-heavy sites. If your data has a different shape, tune
 * LIST_PATH_PATTERNS and the LONG_TEXT threshold below. */

const LIST_PATH_PATTERNS = [
  /list/i, /index/i, /search/i, /results/i, /verzeichnis/i,
  /\?pid=\d+/, /page_id=\d+/,
]
const SHORT_NAV_MAX = 28        // a click on text <= this is treated as nav
const LONG_DETAIL_MIN = 28      // a click on text > this is treated as detail
const NOISY_TEXT_MARKERS = /(Fächer:|F\u00e4cher:|e-Mail:|E-Mail:|Tel:|Telefon:|MA\s|Mag\.|BEd|Phil-Phys)/i

function classifyStep(s: AgentStep, prevMilestone: Milestone | null): Milestone {
  const c = canonicalAction(s)

  if (c === 'navigate')           return 'page'
  if (c === 'done') {
    // Done action: check outcome to pick the right terminal milestone.
    // @ts-ignore
    const outcome: string | undefined = s.outcome
    if (outcome === 'failed') return 'failed'
    if (outcome === 'incomplete') return 'incomplete'
    return 'done'
  }
  if (c === 'input')              return 'input'
  if (c === 'extract')            return 'extract'
  if (c === 'scroll')             return 'scroll'
  if (c === 'back')               return prevMilestone === 'detail-view' ? 'list-view' : 'page'

  if (c === 'click') {
    const text = stepTargetText(s) ?? ''
    const len = text.length

    // URL-based hint: clicking on a list page suggests we're in a list-view,
    // and the click is opening a detail item.
    const url = s.url ?? ''
    const onListPage = LIST_PATH_PATTERNS.some(p => p.test(url))

    if (len === 0)                        return 'nav'           // unknown — assume nav
    if (NOISY_TEXT_MARKERS.test(text))    return 'detail-view'   // teacher cards etc.
    if (len >= LONG_DETAIL_MIN)           return 'detail-view'
    if (onListPage && len < SHORT_NAV_MAX) return 'list-view'    // a click within a list
    if (len < SHORT_NAV_MAX)              return 'nav'
    return 'detail-view'
  }

  return 'other'
}

/* Make a tooltip-friendly label for the raw step inside a link aggregate.
 * Long item labels collapse to a generic '(item)' so the tooltip is readable. */
function readableActionLabel(s: AgentStep): string {
  const c = canonicalAction(s)
  switch (c) {
    case 'click': {
      const t = stepTargetText(s) ?? ''
      if (!t) return 'click'
      if (t.length > SHORT_NAV_MAX || NOISY_TEXT_MARKERS.test(t)) return 'click (item)'
      return `click: ${truncate(t, 32)}`
    }
    case 'input': {
      const v = stepInputValue(s) ?? ''
      return v ? `type: "${truncate(v, 24)}"` : 'type'
    }
    case 'navigate': {
      const target = stepNavTarget(s)
      return target ? `nav: ${truncate(pagePath(target), 36)}` : 'navigate'
    }
    case 'scroll':  return 'scroll'
    case 'back':    return '← back'
    case 'extract': return 'extract'
    case 'wait':    return 'wait'
    case 'key':     return 'key'
    case 'tab':     return 'tab'
    case 'done':    return '✓ done'
    default: return s.action_type ?? 'action'
  }
}

/* Drop steps that produce no useful node. */
function isMeaningfulStep(s: AgentStep): boolean {
  if (!s.url?.startsWith('http')) return false
  return canonicalAction(s) !== null
}

interface JourneyMeta {
  id: string
  kind: 'agent' | 'human'
  index: number
  label: string
  steps: AgentStep[]
}

interface NodeDatum {
  id: number
  name: string
  milestone: Milestone
  layer: number
  /* Each visit corresponds to one journey passing through this milestone.
   * stepIdx is the index of the first raw step in that journey that fell
   * into this milestone bucket. elementLabel/coords describe the *primary*
   * step inside this run (the first click step if one exists, otherwise the
   * first step) — used to detect divergence: two visits to the same node
   * with different elementLabels = an "interesting" divergence. */
  visits: Array<{
    journeyId: string
    stepIdx: number
    stepsHere: number
    elementLabel?: string
    /* Coords are page-percent rectangles (x, y, w, h) when available. */
    elementCoords?: { x: number; y: number; width: number; height: number }
  }>
}

interface LinkDatum {
  source: number
  target: number
  value: number              // visual width is driven by this; we set it to
                             // the number of raw steps spent in the source
                             // milestone for this journey, so density shows up
  journeyId: string
  stepIdx: number            // first raw step in the source bucket
  rawSteps: Array<{ stepIdx: number; label: string }>  // for tooltip drilldown
}

interface Graph {
  nodes: NodeDatum[]
  links: LinkDatum[]
}

function buildGraph(journeys: JourneyMeta[]): Graph {
  const idx = new Map<string, number>()
  const nodes: NodeDatum[] = []
  const links: LinkDatum[] = []

  function nodeId(milestone: Milestone): number {
    const label = MILESTONE_LABEL[milestone]
    let id = idx.get(label)
    if (id === undefined) {
      id = nodes.length
      idx.set(label, id)
      nodes.push({
        id,
        name: label,
        milestone,
        layer: MILESTONE_ORDER[milestone],
        visits: [],
      })
    }
    return id
  }

  for (const j of journeys) {
    /* Step 1 — keep meaningful steps. */
    const kept: Array<{ step: AgentStep; stepIdx: number }> = []
    j.steps.forEach((s, i) => {
      if (!isMeaningfulStep(s)) return
      kept.push({ step: s, stepIdx: i })
    })
    if (kept.length === 0) continue

    /* Step 2 — classify each step into a milestone, threading the previous
     * milestone so scrolls inherit context. */
    const classified: Array<{ stepIdx: number; milestone: Milestone; label: string }> = []
    let prev: Milestone | null = null
    for (const k of kept) {
      const m = classifyStep(k.step, prev)
      classified.push({ stepIdx: k.stepIdx, milestone: m, label: readableActionLabel(k.step) })
      prev = m
    }

    /* Step 3 — bucket consecutive same-milestone steps into runs. Each run
     * = one "stay" in that milestone for this journey. */
    type Run = {
      milestone: Milestone
      firstStepIdx: number
      rawSteps: Array<{ stepIdx: number; label: string }>
    }
    const runs: Run[] = []
    for (const c of classified) {
      const last = runs[runs.length - 1]
      if (last && last.milestone === c.milestone) {
        last.rawSteps.push({ stepIdx: c.stepIdx, label: c.label })
      } else {
        runs.push({
          milestone: c.milestone,
          firstStepIdx: c.stepIdx,
          rawSteps: [{ stepIdx: c.stepIdx, label: c.label }],
        })
      }
    }

    /* Step 4 — prepend an implicit 'start' milestone if not already there. */
    if (runs.length === 0 || runs[0].milestone !== 'start') {
      runs.unshift({
        milestone: 'start',
        firstStepIdx: 0,
        rawSteps: [{ stepIdx: 0, label: 'start' }],
      })
    }
    /* …and a terminal milestone if not already present. The terminal is one
     * of `done`, `failed`, or `incomplete`. For AI journeys, we read the
     * `outcome` field on the final step (set by the Python agent runner).
     * For human journeys, we don't have outcome data yet, so we default to
     * `done`. */
    const TERMINALS: Milestone[] = ['done', 'failed', 'incomplete']
    if (!TERMINALS.includes(runs[runs.length - 1].milestone)) {
      const lastStep = kept[kept.length - 1]
      // @ts-ignore — outcome may not be on the strict type
      const outcome: string | undefined = lastStep.step?.outcome
      let terminal: Milestone = 'done'
      if (j.kind === 'agent' || j.kind === 'human') {
        if (outcome === 'failed') terminal = 'failed'
        else if (outcome === 'incomplete') terminal = 'incomplete'
        else if (outcome === 'success') terminal = 'done'
        // No outcome → assume success (legacy AI runs)
      }
      runs.push({
        milestone: terminal,
        firstStepIdx: lastStep.stepIdx,
        rawSteps: [{ stepIdx: lastStep.stepIdx, label: 'end of run' }],
      })
    }

    /* Step 5 — register milestone nodes for this journey. For each run, find
     * the "primary" step — the first step in the run that's a click (if any),
     * otherwise the first step. That step's element text + coordinates are
     * what we attach to the visit, so divergence can be detected later. */
    const runNodeIds: number[] = runs.map(r => {
      const nid = nodeId(r.milestone)

      // Find primary step in this run.
      let primaryStep: AgentStep | undefined
      for (const rs of r.rawSteps) {
        const s = j.steps[rs.stepIdx]
        if (s && canonicalAction(s) === 'click') { primaryStep = s; break }
      }
      if (!primaryStep) primaryStep = j.steps[r.firstStepIdx]

      const elementLabel = primaryStep ? stepTargetText(primaryStep) : undefined
      // @ts-ignore — element_coordinates may not be on the strict type
      const ec = primaryStep?.element_coordinates
      const elementCoords = (ec && typeof ec.x === 'number' && typeof ec.y === 'number')
        ? { x: ec.x, y: ec.y, width: ec.width ?? 0, height: ec.height ?? 0 }
        : undefined

      nodes[nid].visits.push({
        journeyId: j.id,
        stepIdx: r.firstStepIdx,
        stepsHere: r.rawSteps.length,
        elementLabel,
        elementCoords,
      })
      return nid
    })

    /* Step 6 — handle cycles. Because nodes are keyed by milestone, a
     * journey can revisit a milestone (e.g. list → detail → list). d3-sankey
     * can't draw cycles, so for the diagram we only keep the first occurrence
     * of each node in the chain — but we still aggregate stepsHere across all
     * visits, so the node's badge reflects the full time spent there. */
    const seen = new Set<number>()
    const chain: Array<{ nid: number; run: Run }> = []
    for (let i = 0; i < runNodeIds.length; i++) {
      const nid = runNodeIds[i]
      if (seen.has(nid)) {
        // Fold the revisit's raw steps into the first chain entry's run.
        const firstEntry = chain.find(e => e.nid === nid)
        if (firstEntry) firstEntry.run.rawSteps.push(...runs[i].rawSteps)
        continue
      }
      seen.add(nid)
      chain.push({ nid, run: runs[i] })
    }

    /* Step 7 — emit one link per forward transition, with value = number of
     * raw steps spent in the SOURCE milestone (so width = density).
     *
     * Cycle avoidance: d3-sankey requires a DAG. A single journey's chain is
     * already deduped (Step 6), so it has no cycles on its own. But when
     * MULTIPLE journeys are merged into one graph, one journey going
     * "scroll → nav" and another going "nav → scroll" creates a cycle
     * (scroll ↔ nav) that d3-sankey rejects. We use MILESTONE_ORDER as a
     * stable topological order and skip any "backward" link. The skipped
     * journey transition is rare in practice; its raw step count is still
     * counted toward the source node's visit metadata. */
    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i]
      const dst = chain[i + 1]
      const srcOrder = MILESTONE_ORDER[nodes[src.nid].milestone]
      const dstOrder = MILESTONE_ORDER[nodes[dst.nid].milestone]
      if (dstOrder <= srcOrder) {
        // Backward (or self) — would create a cycle when merged with other
        // journeys. Skip the link; the source node still has the visit.
        continue
      }
      links.push({
        source: src.nid,
        target: dst.nid,
        value: Math.max(1, src.run.rawSteps.length),
        journeyId: j.id,
        stepIdx: src.run.firstStepIdx,
        rawSteps: src.run.rawSteps,
      })
    }
  }

  return { nodes, links }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Tooltip
 * ────────────────────────────────────────────────────────────────────────── */

interface TooltipState {
  x: number
  y: number
  kind: 'node' | 'link'
  nodeName?: string
  fromName?: string
  toName?: string
  step?: AgentStep
  journeyMeta?: JourneyMeta
  otherRunsCount?: number
  /* When hovering a link: the list of raw actions the journey took in the
   * source milestone. Lets the tooltip show "12 steps: scroll, click (item),
   * scroll, click (item), …" instead of just one. */
  rawSteps?: Array<{ stepIdx: number; label: string }>
  /* When hovering a node: how many steps this journey spent in this
   * milestone. */
  stepsHere?: number
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Divergence detection
 *
 *  A milestone node is "divergent" if multiple journeys reached it via
 *  different element clicks. Two visits are considered to belong to the same
 *  group when their elementLabels match (case-insensitive, trimmed). If labels
 *  match exactly but coordinates differ significantly (>= COORD_TOL %), they
 *  still go in separate groups — same text on different parts of the page is
 *  almost certainly a different element (e.g. a top-nav link vs a sidebar link
 *  with the same text).
 * ────────────────────────────────────────────────────────────────────────── */

const COORD_TOL = 5  // percent — visits with this much position difference are "different"

/* Normalize a clicked-element label so the same button captured slightly
 * differently by different recorders still groups together. Strips:
 *   - trailing UI chrome glyphs and separators: » › → – — | -
 *   - trailing path/breadcrumb suffixes like " – Liste", " | Home", " — Foo"
 *   - leading/trailing whitespace, repeated internal whitespace
 *   - case (lowercased for comparison)
 *
 * Used ONLY for matching/grouping, never for display. The display label
 * stays whatever was originally captured.
 *
 * Examples:
 *   "Schulgemeinschaft »"       → "schulgemeinschaft"
 *   "Schulgemeinschaft"         → "schulgemeinschaft"   ← same group
 *   "Lehrer:innen – Liste"      → "lehrer:innen"
 *   "Lehrer:innen"              → "lehrer:innen"        ← same group
 *   "  HOME  | brg14  "         → "home"
 */
function canonicalLabel(label: string): string {
  if (!label) return ''
  let s = label.trim()
  // Repeatedly peel trailing chrome and "after-separator" suffixes until stable.
  // We do this in a loop because labels like "Foo » › Bar" need multiple passes.
  let prev: string
  do {
    prev = s
    // Trailing standalone chrome glyphs
    s = s.replace(/[\s»›→–—|-]+$/u, '').trim()
    // Trailing "  — Foo" / " – Foo" / " | Foo" / " - Foo" style suffixes
    // (separator with surrounding spaces + trailing word)
    s = s.replace(/\s+[–—|-]\s+\S.*$/u, '').trim()
  } while (s !== prev && s.length > 0)
  // Collapse internal whitespace runs into a single space.
  s = s.replace(/\s+/g, ' ').toLowerCase()
  return s
}

export interface DivergenceGroup {
  label: string                    // representative element text
  visits: Array<NodeDatum['visits'][number]>   // visits in this group
}

export interface NodeDivergence {
  nodeId: number
  nodeName: string
  milestone: Milestone
  groups: DivergenceGroup[]
}

function detectDivergences(graph: Graph, journeyMap: Map<string, JourneyMeta>): NodeDivergence[] {
  const out: NodeDivergence[] = []

  debug('[divergence] all nodes:', graph.nodes.map(n => ({
  name: n.name,
  visits: n.visits.length,
  perVisit: n.visits.map(v => ({
    journey: journeyMap.get(v.journeyId)?.label,
    rawLabel: v.elementLabel ?? '(none)',
    canonical: v.elementLabel ? canonicalLabel(v.elementLabel) : '(none)',
  })),
})))


  for (const node of graph.nodes) {
    /* Skip milestones where divergence isn't meaningful. start/scroll/done/
     * other have nothing element-specific to compare. */
    if (
      node.milestone === 'start' ||
      node.milestone === 'done' ||
      node.milestone === 'failed' ||
      node.milestone === 'incomplete' ||
      node.milestone === 'scroll' ||
      node.milestone === 'other'
    ) continue
    if (node.visits.length < 2) continue

    /* Step 1: group visits by element label (with coordinate disambiguation
     * for same-text-different-position cases). */
    const groups: DivergenceGroup[] = []
    for (const v of node.visits) {
      const label = (v.elementLabel ?? '').trim()
      if (!label) continue
      const vKind = journeyMap.get(v.journeyId)?.kind

      const existing = groups.find(g => {
        if (g.label !== label) return false
        const rep = g.visits[0]
        const repKind = journeyMap.get(rep.journeyId)?.kind
        // Same canonical label is enough to merge ACROSS kinds (AI ↔ human)
        // because their coord systems aren't comparable. Within the same
        // kind we still use coord disambiguation to tell "Lehrer:innen in
        // top nav" from "Lehrer:innen in sidebar".
        const sameKind = vKind && repKind && vKind === repKind
        if (sameKind && rep.elementCoords && v.elementCoords) {
          const dx = Math.abs(rep.elementCoords.x - v.elementCoords.x)
          const dy = Math.abs(rep.elementCoords.y - v.elementCoords.y)
          if (dx > COORD_TOL || dy > COORD_TOL) return false
        }
        return true
      })

      if (existing) existing.visits.push(v)
      else groups.push({ label, visits: [v] })
    }

    if (groups.length < 2) continue

    /* Step 2: collapse groups by representative *journey set*. The same journey
     * appearing in multiple groups (e.g. User #2 clicking 3 different nav
     * links over time) is not a real divergence — it's just one user
     * navigating. We only care when DIFFERENT journeys took DIFFERENT paths. */
    const journeyToGroups = new Map<string, Set<number>>()
    groups.forEach((g, gi) => {
      for (const v of g.visits) {
        if (!journeyToGroups.has(v.journeyId)) journeyToGroups.set(v.journeyId, new Set())
        journeyToGroups.get(v.journeyId)!.add(gi)
      }
    })

    // How many journeys appear in this milestone, and how many distinct groups
    // do they collectively use as a "primary" group?
    const distinctJourneys = journeyToGroups.size
    if (distinctJourneys < 2) continue   // only one journey involved → not a divergence

    /* For each journey, pick its FIRST visit's group as the "chosen" path.
     * If different journeys chose different groups, that's a real divergence. */
    const chosenGroupByJourney = new Map<string, number>()
    for (const v of node.visits) {
      if (chosenGroupByJourney.has(v.journeyId)) continue
      const label = (v.elementLabel ?? '').trim()
      if (!label) continue
      const groupIdx = groups.findIndex(g => g.visits.includes(v))
      if (groupIdx >= 0) chosenGroupByJourney.set(v.journeyId, groupIdx)
    }
    const distinctChosenGroups = new Set(chosenGroupByJourney.values())
    if (distinctChosenGroups.size < 2) continue   // all journeys chose the same group

    /* Step 3: rebuild presentable groups containing only one entry per journey
     * (its FIRST visit), so the panel doesn't show clutter. */
    const presentable: DivergenceGroup[] = []
    const seenJourney = new Set<string>()
    for (const v of node.visits) {
      if (seenJourney.has(v.journeyId)) continue
      const label = (v.elementLabel ?? '').trim()
      if (!label) continue
      seenJourney.add(v.journeyId)
      const vKind = journeyMap.get(v.journeyId)?.kind

      const existing = presentable.find(g => {
        if (g.label !== label) return false
        const rep = g.visits[0]
        const repKind = journeyMap.get(rep.journeyId)?.kind
        const sameKind = vKind && repKind && vKind === repKind
        if (sameKind && rep.elementCoords && v.elementCoords) {
          const dx = Math.abs(rep.elementCoords.x - v.elementCoords.x)
          const dy = Math.abs(rep.elementCoords.y - v.elementCoords.y)
          if (dx > COORD_TOL || dy > COORD_TOL) return false
        }
        return true
      })
      if (existing) existing.visits.push(v)
      else presentable.push({ label, visits: [v] })
    }

    if (presentable.length < 2) continue
    
    /* debug*/
    if (node.name === "navigation click") {
      debug("=== Debugging Navigation Click Node ===");
      node.visits.forEach(v => {
        const meta = journeyMap.get(v.journeyId);
        debug(`Journey: ${meta?.label}, Clicked Label: "${v.elementLabel}"`);
      });
    }

    out.push({
      nodeId: node.id,
      nodeName: node.name,
      milestone: node.milestone,
      groups: presentable,
    })
  }
  out.sort((a, b) => MILESTONE_ORDER[a.milestone] - MILESTONE_ORDER[b.milestone])
  return out
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Component
 * ────────────────────────────────────────────────────────────────────────── */

export default function SankeyDiagram({
  agentJourneys,
  humanJourneys = [],
  agentLabels,
  humanLabels,
  onDivergencesChange,
  highlight,
  linkedMode = false,
  rightControl,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const journeys = useMemo<JourneyMeta[]>(() => {
    const list: JourneyMeta[] = []
    agentJourneys.forEach((steps, i) => list.push({
      id: `agent-${i}`, kind: 'agent', index: i,
      label: agentLabels?.[i] ?? `AI Run #${i + 1}`,
      steps,
    }))
    humanJourneys.forEach((steps, i) => list.push({
      id: `human-${i}`, kind: 'human', index: i,
      label: humanLabels?.[i] ?? `User #${i + 1}`,
      steps,
    }))
    return list
  }, [agentJourneys, humanJourneys, agentLabels, humanLabels])

  const journeyMap = useMemo(() => new Map(journeys.map(j => [j.id, j])), [journeys])

  const visibleJourneys = journeys

  const graph = useMemo(() => buildGraph(visibleJourneys), [visibleJourneys])

  /* Divergences — nodes where journeys arrived via different elements. */
  const divergences = useMemo(
  () => {
    return detectDivergences(graph, journeyMap)
  },
  [graph, journeyMap],
)
  const divergentNodeIds = useMemo(
    () => new Set(divergences.map(d => d.nodeId)),
    [divergences],
  )
  useEffect(() => {
    onDivergencesChange?.(divergences)
  }, [divergences, onDivergencesChange])

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoverJourneyId, setHoverJourneyId] = useState<string | null>(null)

  /* ── Linked-mode state (horizon strip) ────────────────────────────────────
   * pinnedJourneyId  — journey kept active after the mouse leaves (click to pin)
   * cursorX          — mouse x in Sankey inner coords, for the synced cursor
   * svgW             — current SVG width, so the strip matches it exactly
   * journeyExtents   — per-journey [xStart, xEnd] pixel span (Sankey inner coords)
   * journeyMilestones — ordered milestone x-centers for each journey, used by the strip
   *                     to draw reference lines aligned to the Sankey columns above */
  const [pinnedJourneyId, setPinnedJourneyId] = useState<string | null>(null)
  const [cursorX, setCursorX] = useState<number | null>(null)
  const [svgW, setSvgW] = useState(860)
  const [journeyExtents, setJourneyExtents] = useState<Map<string, { xStart: number; xEnd: number }>>(new Map())
  const [journeyMilestones, setJourneyMilestones] = useState<Map<string, Array<{ x: number; label: string }>>>(new Map())
  /* Modal: when set, shows a full step-by-step view of this journey. */
  const [modalJourneyId, setModalJourneyId] = useState<string | null>(null)

  /* Resize tick: incremented every time the SVG container changes size, so
   * the d3 redraw effect re-runs. ResizeObserver fires on viewport resize,
   * sidebar toggles, modal open/close, etc. */
  const [resizeTick, setResizeTick] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setResizeTick(t => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasData = graph.nodes.length > 0 && graph.links.length > 0

  /* Node color: terminal milestones (done/failed/incomplete) get their own
   * fixed colors so success/failure is visually unambiguous. Other nodes use
   * the kind-blend rule: agent-only, human-only, or mixed. */
  const nodeColor = useCallback((node: NodeDatum): string => {
    const terminalColor = TERMINAL_COLORS[node.milestone]
    if (terminalColor) return terminalColor
    let a = false, h = false
    for (const v of node.visits) {
      const k = journeyMap.get(v.journeyId)?.kind
      if (k === 'agent') a = true
      else if (k === 'human') h = true
      if (a && h) return TEXT_DARK
    }
    return a ? AGENT_COLOR : HUMAN_COLOR
  }, [journeyMap])

  /* ── d3 render ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    // Clear tooltip whenever the SVG rebuilds — elements and their mouseleave
    // handlers are removed by selectAll('*').remove(), so the tooltip state
    // would otherwise stay stale.
    setTooltip(null)
    setHoverJourneyId(null)
    if (!hasData) return

    const containerW = containerRef.current?.clientWidth ?? 860
    const containerH = containerRef.current?.clientHeight ?? 380
    const W = Math.max(containerW, 400)
    // Compute the "natural" height needed for the data (room for journeys to
    // stack). If the container is taller, use the container height — the
    // diagram fills the available space. If the data needs more, scroll.
    const naturalH = Math.max(380, graph.nodes.length * 28 + journeys.length * 8)
    const H = Math.max(naturalH, containerH)
    const iw = W - MARGIN.left - MARGIN.right
    const ih = H - MARGIN.top - MARGIN.bottom

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)

    const layout = d3Sankey<NodeDatum, LinkDatum>()
      .nodeId((d: any) => d.id)
      .nodeWidth(14)
      .nodePadding(22)
      .extent([[0, 0], [iw, ih]])

    let laidOut: any
    try {
      laidOut = layout({
        nodes: graph.nodes.map(n => ({ ...n })),
        links: graph.links.map(l => ({ ...l })),
      })
    } catch (e) {
      debugWarn('Sankey layout error', e)
      return
    }

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    /* ── Linked mode: per-journey horizontal pixel span ────────────────────
     * For each journey, find the left edge of its first node and the right edge
     * of its last node. The docked horizon strip uses this span (in the same
     * inner-coordinate system as `g`) so its time axis aligns with the flow. */
    if (linkedMode) {
      const extents = new Map<string, { xStart: number; xEnd: number }>()
      /* Per-journey: collect (stepIdx, nodeXCenter, nodeName) so we can sort
       * by visit order and derive ordered milestone positions for the strip. */
      const milestonesByJourney = new Map<string, Array<{ stepIdx: number; x: number; label: string }>>()
      for (const n of laidOut.nodes as any[]) {
        const xCenter = (n.x0 + n.x1) / 2
        for (const v of (n.visits ?? [])) {
          const cur = extents.get(v.journeyId)
          if (!cur) extents.set(v.journeyId, { xStart: n.x0, xEnd: n.x1 })
          else { cur.xStart = Math.min(cur.xStart, n.x0); cur.xEnd = Math.max(cur.xEnd, n.x1) }
          const arr = milestonesByJourney.get(v.journeyId) ?? []
          arr.push({ stepIdx: v.stepIdx, x: xCenter, label: n.name })
          milestonesByJourney.set(v.journeyId, arr)
        }
      }
      /* Sort each journey's milestones by step order so they appear left→right
       * in the same order the journey actually progressed. */
      const milestones = new Map<string, Array<{ x: number; label: string }>>()
      for (const [jId, pts] of milestonesByJourney) {
        pts.sort((a, b) => a.stepIdx - b.stepIdx)
        milestones.set(jId, pts.map(p => ({ x: p.x, label: p.label })))
      }
      setJourneyExtents(extents)
      setJourneyMilestones(milestones)
      setSvgW(W)
    }

    /* ── Links: one ribbon per journey traversal ──────────────────────── */
    const linkSel = g.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(laidOut.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal() as any)
      .attr('stroke', (d: any) => {
        const link = d as LinkDatum
        const meta = journeyMap.get(link.journeyId)
        return meta ? colorForJourney(meta.kind, meta.index) : '#999'
      })
      .attr('stroke-width', (d: any) => Math.max(3, d.width ?? 3))
      .attr('opacity', NORMAL_OPACITY)
      .attr('cursor', 'pointer')

    /* Disambiguate single-click (pin) from double-click (inspect) in linked
     * mode. Shared across both handlers since they're attached in one effect. */
    let clickTimer: ReturnType<typeof setTimeout> | null = null

    linkSel.on('mousemove', function (event: MouseEvent, d: any) {
      const link = d as LinkDatum
      setHoverJourneyId(link.journeyId)
      const meta = journeyMap.get(link.journeyId)
      const step = meta?.steps[link.stepIdx]
      if (linkedMode) {
        // Mouse x in the same inner coords the strip uses (g is offset by MARGIN.left).
        const svgRect = svgRef.current?.getBoundingClientRect()
        setCursorX(event.clientX - (svgRect?.left ?? 0) - MARGIN.left)
      }
      const fromNode = laidOut.nodes.find((n: any) =>
        n.id === (typeof link.source === 'object' ? (link.source as any).id : link.source))
      const toNode = laidOut.nodes.find((n: any) =>
        n.id === (typeof link.target === 'object' ? (link.target as any).id : link.target))
      setTooltip({
        x: event.clientX,
        y: event.clientY,
        kind: 'link',
        fromName: fromNode?.name ?? '',
        toName: toNode?.name ?? '',
        step,
        journeyMeta: meta,
        rawSteps: link.rawSteps,
      })
    })
    linkSel.on('mouseleave', () => { setHoverJourneyId(null); setTooltip(null); if (linkedMode) setCursorX(null) })
    linkSel.on('click', (_: MouseEvent, d: any) => {
      const link = d as LinkDatum
      setTooltip(null)
      if (!linkedMode) { setModalJourneyId(link.journeyId); return }
      // Defer pin so a double-click can cancel it and open the detail modal.
      if (clickTimer) clearTimeout(clickTimer)
      clickTimer = setTimeout(() => {
        setPinnedJourneyId(prev => (prev === link.journeyId ? null : link.journeyId))
        clickTimer = null
      }, 220)
    })
    linkSel.on('dblclick', (_: MouseEvent, d: any) => {
      if (!linkedMode) return
      const link = d as LinkDatum
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
      setTooltip(null)
      setModalJourneyId(link.journeyId)
    })

    /* ── Nodes ─────────────────────────────────────────────────────────── */
    const nodeG = g.append('g').selectAll('g').data(laidOut.nodes).join('g')

    const rectSel = nodeG.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => Math.max(4, d.y1 - d.y0))
      .attr('rx', 3)
      .attr('fill', (d: any) => nodeColor(d as NodeDatum))
      .attr('cursor', 'default')

    rectSel.on('mousemove', function (event: MouseEvent, d: any) {
      const node = d as NodeDatum
      const last = node.visits[node.visits.length - 1]
      if (!last) return
      setHoverJourneyId(null)
      const meta = journeyMap.get(last.journeyId)
      const step = meta?.steps[last.stepIdx]
      setTooltip({
        x: event.clientX,
        y: event.clientY,
        kind: 'node',
        nodeName: node.name,
        step,
        journeyMeta: meta,
        otherRunsCount: node.visits.length - 1,
        stepsHere: last.stepsHere,
      })
    })
    rectSel.on('mouseleave', () => { setTooltip(null) })
    // No click handler on nodes either.

    /* ── Divergence markers ───────────────────────────────────────────────
     * Small amber circle with a ⚡ glyph on nodes where journeys arrived via
     * different element clicks. Positioned at the node's top-right corner. */
    const divergentNodeG = nodeG.filter((d: any) => divergentNodeIds.has((d as NodeDatum).id))
    divergentNodeG.append('circle')
      .attr('cx', (d: any) => d.x1 + 4)
      .attr('cy', (d: any) => d.y0 - 2)
      .attr('r', 7)
      .attr('fill', '#3b82f6')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'none')
    divergentNodeG.append('text')
      .attr('x', (d: any) => d.x1 + 4)
      .attr('y', (d: any) => d.y0 - 2)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.36em')
      .attr('font-size', 8)
      .attr('font-weight', 900)
      .attr('fill', '#fff')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text('!')

    /* ── Node labels ───────────────────────────────────────────────────── */
    nodeG.append('text')
      .attr('x', (d: any) => (d.x0 < iw / 2 ? d.x1 + 8 : d.x0 - 8))
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '-0.25em')
      .attr('text-anchor', (d: any) => (d.x0 < iw / 2 ? 'start' : 'end'))
      .attr('font-size', 11)
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('font-weight', 600)
      .attr('fill', (d: any) => nodeColor(d as NodeDatum))
      .attr('pointer-events', 'none')
      .text((d: any) => {
        const node = d as NodeDatum
        // For scroll: show 'scrolled ×N' where N = max steps any journey did
        if (node.milestone === 'scroll') {
          const maxSteps = Math.max(...node.visits.map(v => v.stepsHere), 0)
          return maxSteps > 1 ? `scrolled ×${maxSteps} (max)` : 'scrolled'
        }
        return node.name
      })

    nodeG.append('text')
      .attr('x', (d: any) => (d.x0 < iw / 2 ? d.x1 + 8 : d.x0 - 8))
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '1em')
      .attr('text-anchor', (d: any) => (d.x0 < iw / 2 ? 'start' : 'end'))
      .attr('font-size', 9)
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('fill', TEXT_MUTED)
      .attr('pointer-events', 'none')
      .text((d: any) => {
        const node = d as NodeDatum
        const a = node.visits.filter(v => journeyMap.get(v.journeyId)?.kind === 'agent')
        const h = node.visits.filter(v => journeyMap.get(v.journeyId)?.kind === 'human')
        const parts: string[] = []
        if (a.length > 0) {
          const total = a.reduce((sum, v) => sum + v.stepsHere, 0)
          parts.push(a.length === 1 ? `AI: ${total} steps` : `AI×${a.length}: ${total} steps`)
        }
        if (h.length > 0) {
          const total = h.reduce((sum, v) => sum + v.stepsHere, 0)
          parts.push(h.length === 1 ? `H: ${total} steps` : `H×${h.length}: ${total} steps`)
        }
        return parts.join(' · ')
      })

    /* Apply highlight-based dimming as part of the initial render so that
     * resizes (which re-run this effect) always restore the correct state.
     * The hover effect below temporarily overrides this during mouse interaction. */
    if (highlight?.focus === 'divergence' && divergentNodeIds.size > 0) {
      g.selectAll('path').attr('opacity', function (d: any) {
        const link = d as any
        const srcId = typeof link.source === 'object' ? link.source.id : null
        const tgtId = typeof link.target === 'object' ? link.target.id : null
        const touches = (srcId && divergentNodeIds.has(srcId)) || (tgtId && divergentNodeIds.has(tgtId))
        return touches ? HIGHLIGHT_OPACITY : DIM_OPACITY
      })
      g.selectAll('rect')
        .attr('opacity', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? 1 : DIM_OPACITY))
        .attr('stroke', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? '#3b82f6' : 'none'))
        .attr('stroke-width', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? 3 : 0))
    } else {
      const focusKindInit = highlight?.side === 'ai' ? 'agent' : highlight?.side === 'human' ? 'human' : null
      if (focusKindInit) {
        g.selectAll('path').attr('opacity', function (d: any) {
          const meta = journeyMap.get((d as LinkDatum).journeyId)
          return meta?.kind === focusKindInit ? NORMAL_OPACITY : DIM_OPACITY
        })
        g.selectAll('rect').attr('opacity', function (d: any) {
          const node = d as NodeDatum
          const hasKind = node.visits?.some(v => journeyMap.get(v.journeyId)?.kind === focusKindInit)
          return hasKind ? 1 : DIM_OPACITY
        })
      }
    }
  }, [graph, journeyMap, journeys.length, hasData, nodeColor, divergentNodeIds, resizeTick, highlight, linkedMode])

  /* ── Hover / highlight: dim non-relevant journeys ───────────────────────── */

  useEffect(() => {
    const svg = d3.select(svgRef.current!)

    // A pinned journey (linked mode) stays highlighted when the mouse leaves.
    const activeId = hoverJourneyId ?? pinnedJourneyId
    if (activeId) {
      svg.selectAll<SVGPathElement, LinkDatum>('path').attr('opacity', function (d: any) {
        return (d as LinkDatum).journeyId === activeId ? HIGHLIGHT_OPACITY : DIM_OPACITY
      })
      svg.selectAll<SVGRectElement, NodeDatum>('rect').attr('opacity', function (d: any) {
        const node = d as NodeDatum
        const match = node.visits?.some(v => v.journeyId === activeId)
        return match ? 1 : DIM_OPACITY
      })
      return
    }

    // Divergence focus: emphasise the milestone nodes where journeys split,
    // and the flows passing through them. Works even with one-sided data.
    if (highlight?.focus === 'divergence' && divergentNodeIds.size > 0) {
      svg.selectAll<SVGPathElement, LinkDatum>('path').attr('opacity', function (d: any) {
        const link = d as any
        const srcId = typeof link.source === 'object' ? link.source.id : null
        const tgtId = typeof link.target === 'object' ? link.target.id : null
        const touches = (srcId && divergentNodeIds.has(srcId)) || (tgtId && divergentNodeIds.has(tgtId))
        return touches ? HIGHLIGHT_OPACITY : DIM_OPACITY
      })
      svg.selectAll<SVGRectElement, NodeDatum>('rect')
        .attr('opacity', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? 1 : DIM_OPACITY))
        .attr('stroke', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? '#3b82f6' : 'none'))
        .attr('stroke-width', (d: any) => (divergentNodeIds.has((d as NodeDatum).id) ? 3 : 0))
      return
    }
    // Not in divergence mode — clear any divergence outline.
    svg.selectAll('rect').attr('stroke', 'none').attr('stroke-width', 0)

    const focusKind = highlight?.side === 'ai' ? 'agent' : highlight?.side === 'human' ? 'human' : null

    if (focusKind) {
      svg.selectAll<SVGPathElement, LinkDatum>('path').attr('opacity', function (d: any) {
        const meta = journeyMap.get((d as LinkDatum).journeyId)
        return meta?.kind === focusKind ? NORMAL_OPACITY : DIM_OPACITY
      })
      svg.selectAll<SVGRectElement, NodeDatum>('rect').attr('opacity', function (d: any) {
        const node = d as NodeDatum
        const hasKind = node.visits?.some(v => journeyMap.get(v.journeyId)?.kind === focusKind)
        return hasKind ? 1 : DIM_OPACITY
      })
      return
    }

    svg.selectAll('path').attr('opacity', NORMAL_OPACITY)
    svg.selectAll('rect').attr('opacity', 1)
  }, [hoverJourneyId, pinnedJourneyId, highlight, journeyMap, hasData, divergentNodeIds])

  /* The journey whose horizon strip is shown: the hovered flow, or the pinned
   * one when nothing is hovered. */
  const activeJourney = useMemo<ActiveJourney | null>(() => {
    if (!linkedMode) return null
    const id = hoverJourneyId ?? pinnedJourneyId
    if (!id) return null
    const meta = journeyMap.get(id)
    const ext = journeyExtents.get(id)
    if (!meta || !ext) return null
    return {
      journeyId: id,
      label: meta.label,
      color: colorForJourney(meta.kind, meta.index),
      xStart: ext.xStart,
      xEnd: ext.xEnd,
      actions: actionSamples(meta.steps),
      milestones: journeyMilestones.get(id) ?? [],
      pinned: pinnedJourneyId === id,
    }
  }, [linkedMode, hoverJourneyId, pinnedJourneyId, journeyMap, journeyExtents, journeyMilestones])

  return (
    <div style={{
      padding: '16px 20px', display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden', position: 'relative',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: AGENT_COLOR }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: AGENT_COLOR }} />
            AI
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: HUMAN_COLOR }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: HUMAN_COLOR }} />
            Human
          </span>
          {highlight?.side && highlight.side !== 'both' && (
            <span style={{
              fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: highlight.side === 'ai' ? `${AGENT_COLOR}18` : `${HUMAN_COLOR}18`,
              color: highlight.side === 'ai' ? AGENT_COLOR : HUMAN_COLOR,
              border: `1px solid ${highlight.side === 'ai' ? AGENT_COLOR : HUMAN_COLOR}`,
            }}>
              {highlight.side === 'ai' ? 'AI journeys highlighted' : 'Human journeys highlighted'}
            </span>
          )}
          {highlight?.focus === 'divergence' && divergentNodeIds.size > 0 && (
            <span style={{
              fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd',
            }}>
              ! Divergence points highlighted
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{rightControl}</div>
        </div>
      </div>

      {/* Body */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
        onMouseLeave={() => { setTooltip(null); setHoverJourneyId(null) }}
      >
        {hasData ? (
          <svg ref={svgRef} style={{ display: 'block' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: TEXT_MUTED, gap: 8 }}>
            <span style={{ fontWeight: 600, color: '#64748b' }}>No navigation data yet</span>
            <span style={{ textAlign: 'center', maxWidth: 320, fontSize: '0.78rem' }}>
              Run an agent or record a human session to see the flow diagram.
            </span>
          </div>
        )}

      </div>

      {/* Tooltip — portalled to <body> and clamped to the viewport so the
       *  screenshot card never falls off-screen near the right/bottom edges. */}
      {tooltip && createPortal((() => {
        const TT_W = 360
        const TT_H = 360   // generous estimate incl. screenshot
        const gap = 16
        // Prefer right/below the cursor; flip to left/above when near an edge.
        let left = tooltip.x + gap
        if (left + TT_W > window.innerWidth - 8) left = tooltip.x - TT_W - gap
        left = Math.max(8, Math.min(left, window.innerWidth - TT_W - 8))
        let top = tooltip.y + gap
        if (top + TT_H > window.innerHeight - 8) top = window.innerHeight - TT_H - 8
        top = Math.max(8, top)
        return (
          <div
            style={{
              position: 'fixed',
              left, top,
              pointerEvents: 'none',
              background: '#ffffff',
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              boxShadow: '0 6px 24px rgba(15,23,42,0.18)',
              padding: 10,
              width: TT_W,
              maxHeight: window.innerHeight - 16,
              overflow: 'auto',
              fontSize: '0.72rem',
              color: TEXT_DARK,
              zIndex: 1000,
            }}
          >
            <TooltipBody t={tooltip} />
          </div>
        )
      })(), document.body)}

      {/* Docked horizon strip — only in linked mode */}
      {linkedMode && hasData && (
        <LinkedHorizonStrip
          width={svgW}
          marginLeft={MARGIN.left}
          active={activeJourney}
          cursorX={cursorX}
        />
      )}

      {/* Journey detail modal — portal escapes overflow:hidden ancestors */}
      {modalJourneyId && (() => {
        const j = journeyMap.get(modalJourneyId)
        if (!j) return null
        const color = colorForJourney(j.kind, j.index)
        return createPortal(
          <JourneyDetailModal
            journey={j}
            color={color}
            onClose={() => setModalJourneyId(null)}
          />,
          document.body,
        )
      })()}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Tooltip body
 * ────────────────────────────────────────────────────────────────────────── */

function TooltipBody({ t }: { t: TooltipState }) {
  const screenshot = t.step ? stepScreenshot(t.step) : null
  const action = t.step?.action_type
  const thought = t.step?.thought
  const nextGoal = t.step?.next_goal
  const url = t.step?.url
  const actionColor = action ? (STEP_ACTION_COLORS[action] ?? TEXT_LABEL) : TEXT_LABEL
  const runColor = t.journeyMeta
    ? colorForJourney(t.journeyMeta.kind, t.journeyMeta.index)
    : '#999'
  /* If this is a human step (no next_goal) and `thought` is being used as the
   * element label, don't render it a second time under "Thought:". */
  const thoughtIsElementLabel = !!thought && !nextGoal
  const showThought = !!thought && !thoughtIsElementLabel

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700, color: runColor, fontSize: '0.72rem' }}>
          {t.journeyMeta?.label ?? ''}
        </span>
        {t.kind === 'node' && t.otherRunsCount && t.otherRunsCount > 0 ? (
          <span style={{ fontSize: '0.65rem', color: TEXT_MUTED }}>
            +{t.otherRunsCount} other run{t.otherRunsCount !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      {t.kind === 'link' && (
        <>
          <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: TEXT_LABEL }}>
            {t.fromName} → {t.toName}
          </div>
          {t.rawSteps && t.rawSteps.length > 1 && (
            <div style={{
              fontSize: '0.66rem', color: TEXT_MUTED, lineHeight: 1.45,
              maxHeight: 90, overflow: 'hidden',
            }}>
              <span style={{ fontWeight: 700, color: TEXT_LABEL }}>
                {t.rawSteps.length} actions:
              </span>{' '}
              {t.rawSteps.slice(0, 6).map(r => r.label).join(' → ')}
              {t.rawSteps.length > 6 ? ` → … (+${t.rawSteps.length - 6})` : ''}
            </div>
          )}
        </>
      )}
      {t.kind === 'node' && (
        <>
          <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: TEXT_LABEL }}>
            {t.nodeName}
          </div>
          {t.stepsHere && t.stepsHere > 1 && (
            <div style={{ fontSize: '0.66rem', color: TEXT_MUTED }}>
              {t.stepsHere} steps spent here
            </div>
          )}
        </>
      )}

      {screenshot && (
        <div style={{
          position: 'relative',
          width: '100%',
          /* Bigger and uses 'contain' so the whole page is visible.
           * Width is capped by the tooltip's maxWidth (we bumped it). */
          background: '#0f172a',
          borderRadius: 4,
          border: `1px solid ${BORDER}`,
          overflow: 'hidden',
        }}>
          <img
            src={screenshot}
            alt="step screenshot"
            style={{
              width: '100%',
              maxHeight: 280,
              display: 'block',
              objectFit: 'contain',
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          {/* Click target overlay — drawn only for AI steps. Human screenshots
           * already have a red highlight burned into the image at capture
           * time (tracker.js → captureClickScreenshot), and the events-table
           * coordinates are unreliable when paired with a possibly-rescrolled
           * screenshot. So we skip the overlay for humans entirely. */}
          {t.step && t.journeyMeta?.kind === 'agent' && (t.step as any).element_coordinates && (() => {
            const ec = (t.step as any).element_coordinates as { x: number; y: number; width: number; height: number }
            if (typeof ec.x !== 'number' || typeof ec.y !== 'number') return null
            return (
              <div
                style={{
                  position: 'absolute',
                  left: `${ec.x}%`,
                  top: `${ec.y}%`,
                  width: `${Math.max(0.5, ec.width)}%`,
                  height: `${Math.max(0.5, ec.height)}%`,
                  border: '2px solid #ef4444',
                  borderRadius: 2,
                  boxShadow: '0 0 0 1px rgba(239,68,68,0.4), 0 0 12px rgba(239,68,68,0.6)',
                  pointerEvents: 'none',
                }}
              />
            )
          })()}
        </div>
      )}

      {action && (
        <div>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 4,
            background: `${actionColor}20`, color: actionColor,
            fontWeight: 700, fontSize: '0.65rem',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {action.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {url && (
        <div style={{
          fontFamily: 'monospace', fontSize: '0.66rem', color: TEXT_MUTED,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {url}
        </div>
      )}

      {showThought && thought && (
        <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.6rem', color: TEXT_LABEL, marginRight: 4 }}>
            Thought
          </span>
          {thought.length > 140 ? thought.slice(0, 140) + '…' : thought}
        </div>
      )}
      {nextGoal && (
        <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.6rem', color: TEXT_LABEL, marginRight: 4 }}>
            Next
          </span>
          {nextGoal.length > 140 ? nextGoal.slice(0, 140) + '…' : nextGoal}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Journey detail modal
 *
 *  Full step-by-step view of one journey: list of steps on the left, big
 *  screenshot for the selected step on the right, with click-coordinate
 *  overlay if available. Closes on Esc, click-outside, or X button.
 * ────────────────────────────────────────────────────────────────────────── */

function JourneyDetailModal({
  journey,
  color,
  onClose,
}: {
  journey: JourneyMeta
  color: string
  onClose: () => void
}) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const stepListRef = useRef<HTMLDivElement>(null)

  // Filter to steps that have a recognizable action — same rule the Sankey
  // uses. Drops 'unknown' events the recorder couldn't classify so the modal
  // stays consistent with the diagram.
  const allSteps = journey.steps
  const meaningfulIdxs = allSteps
    .map((s, i) => {
      // Belt and braces: skip explicitly 'unknown' even if isMeaningfulStep
      // recovered something from action_details.
      const at = (s.action_type ?? '').toLowerCase()
      if (!at || at === 'unknown') return -1
      return isMeaningfulStep(s) ? i : -1
    })
    .filter(i => i >= 0)

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        setSelectedIdx(i => Math.min(meaningfulIdxs.length - 1, i + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        setSelectedIdx(i => Math.max(0, i - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [meaningfulIdxs.length, onClose])

  // Scroll the active step into view
  useEffect(() => {
    const el = stepListRef.current?.querySelector<HTMLElement>(`[data-step="${selectedIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIdx])

  const activeStepRawIdx = meaningfulIdxs[selectedIdx]
  const activeStep = activeStepRawIdx !== undefined ? allSteps[activeStepRawIdx] : undefined
  const screenshot = activeStep ? stepScreenshot(activeStep) : null
  // Skip overlay for humans — their screenshots already have a red highlight
  // baked in by the tracker, and the events-table coords are unreliable.
  const ec = (activeStep && journey.kind === 'agent') ? (activeStep as any).element_coordinates : undefined
  const actionType = activeStep?.action_type ?? ''
  const actionColor = STEP_ACTION_COLORS[actionType] ?? '#475569'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          width: 'min(1100px, 96vw)',
          height: 'min(720px, 92vh)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 18px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: color, flexShrink: 0,
            }} />
            <span style={{ fontWeight: 700, color: TEXT_DARK, fontSize: '0.88rem' }}>
              {journey.label}
            </span>
            <span style={{ fontSize: '0.72rem', color: TEXT_MUTED }}>
              {meaningfulIdxs.length} steps
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: TEXT_LABEL,
              fontSize: '1.2rem', cursor: 'pointer', padding: '0 4px',
              lineHeight: 1, fontFamily: 'inherit',
            }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body: list left, viewer right */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Step list */}
          <div
            ref={stepListRef}
            style={{
              width: 280, flexShrink: 0,
              borderRight: `1px solid ${BORDER}`,
              overflowY: 'auto',
              background: '#fafbfc',
            }}
          >
            {meaningfulIdxs.length === 0 && (
              <div style={{ padding: 16, fontSize: '0.78rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
                No meaningful steps in this journey.
              </div>
            )}
            {meaningfulIdxs.map((rawIdx, i) => {
              const step = allSteps[rawIdx]
              const active = i === selectedIdx
              let path = step.url
              try { path = new URL(step.url).pathname || '/' } catch { /* ok */ }
              const at = step.action_type
              const ac = STEP_ACTION_COLORS[at] ?? '#475569'
              return (
                <div
                  key={i}
                  data-step={i}
                  onClick={() => setSelectedIdx(i)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    background: active ? `${color}1a` : 'transparent',
                    borderLeft: `3px solid ${active ? color : 'transparent'}`,
                    borderBottom: '1px solid #f1f5f9',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      fontSize: '0.66rem', fontWeight: 700,
                      color: active ? color : TEXT_MUTED, minWidth: 20,
                      textAlign: 'right', flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700,
                      color: ac, background: `${ac}18`,
                      padding: '1px 5px', borderRadius: 3,
                      textTransform: 'uppercase', letterSpacing: '0.02em',
                    }}>
                      {(at || 'step').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    color: active ? TEXT_DARK : TEXT_LABEL,
                    fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginLeft: 26,
                  }}>{path}</div>
                  {step.thought && (
                    <div style={{
                      fontSize: '0.66rem', color: TEXT_MUTED, marginTop: 1,
                      marginLeft: 26, lineHeight: 1.35,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>{step.thought}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Screenshot viewer */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            background: '#0f172a', overflow: 'hidden',
          }}>
            {/* Toolbar */}
            <div style={{
              padding: '8px 14px',
              background: '#1e293b', borderBottom: '1px solid #334155',
              display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
              color: '#94a3b8',
            }}>
              <button
                onClick={() => setSelectedIdx(i => Math.max(0, i - 1))}
                disabled={selectedIdx === 0}
                style={{
                  background: 'none', border: '1px solid #334155',
                  color: selectedIdx === 0 ? '#334155' : '#94a3b8',
                  borderRadius: 4, width: 26, height: 26,
                  cursor: selectedIdx === 0 ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: '0.85rem',
                }}
              >‹</button>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {selectedIdx + 1} / {meaningfulIdxs.length}
              </span>
              <button
                onClick={() => setSelectedIdx(i => Math.min(meaningfulIdxs.length - 1, i + 1))}
                disabled={selectedIdx === meaningfulIdxs.length - 1}
                style={{
                  background: 'none', border: '1px solid #334155',
                  color: selectedIdx === meaningfulIdxs.length - 1 ? '#334155' : '#94a3b8',
                  borderRadius: 4, width: 26, height: 26,
                  cursor: selectedIdx === meaningfulIdxs.length - 1 ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: '0.85rem',
                }}
              >›</button>
              {activeStep && (
                <>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700,
                    color: actionColor, background: `${actionColor}25`,
                    padding: '2px 8px', borderRadius: 4,
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>
                    {actionType.replace(/_/g, ' ') || 'step'}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', fontFamily: 'monospace',
                    color: '#94a3b8', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {activeStep.url}
                  </span>
                </>
              )}
            </div>

            {/* Image area */}
            <div style={{
              flex: 1, overflow: 'auto', display: 'flex',
              alignItems: 'flex-start', justifyContent: 'center', padding: 20,
            }}>
              {screenshot ? (
                <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                  <img
                    src={screenshot}
                    alt={`Step ${selectedIdx + 1}`}
                    style={{
                      maxWidth: '100%', display: 'block',
                      borderRadius: 4,
                      boxShadow: '0 6px 28px rgba(0,0,0,0.5)',
                    }}
                  />
                  {ec && typeof ec.x === 'number' && typeof ec.y === 'number' && (
                    <div style={{
                      position: 'absolute',
                      left: `${ec.x}%`, top: `${ec.y}%`,
                      width: `${Math.max(0.5, ec.width ?? 1)}%`,
                      height: `${Math.max(0.5, ec.height ?? 1)}%`,
                      border: '2px solid #ef4444',
                      borderRadius: 2,
                      boxShadow: '0 0 0 1px rgba(239,68,68,0.4), 0 0 16px rgba(239,68,68,0.6)',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>
              ) : (
                <div style={{
                  color: '#475569', fontSize: '0.85rem',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  marginTop: 60,
                }}>
                  <span style={{ fontSize: '2rem' }}>📷</span>
                  No screenshot for this step
                </div>
              )}
            </div>

            {/* Bottom: thought + next */}
            {activeStep && (activeStep.thought || activeStep.next_goal) && (
              <div style={{
                flexShrink: 0,
                background: '#1e293b', borderTop: '1px solid #334155',
                padding: '10px 14px',
                maxHeight: 140, overflowY: 'auto',
                fontSize: '0.74rem', color: '#cbd5e1', lineHeight: 1.5,
              }}>
                {activeStep.thought && (
                  <div style={{ marginBottom: activeStep.next_goal ? 8 : 0 }}>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700, color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6,
                    }}>Thought</span>
                    {activeStep.thought}
                  </div>
                )}
                {activeStep.next_goal && (
                  <div>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 700, color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6,
                    }}>Next</span>
                    {activeStep.next_goal}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}