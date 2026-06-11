/**
 * Pure action-point logic: deriving points from a comparative analysis and
 * selecting evidence (agent thoughts / human narratives) relevant to a point.
 *
 * No React, no I/O — unit-tested in src/lib/__tests__/actionPoints.test.ts.
 */

import type { ComparativeAnalysis, TaskComparison, ActionPointItem, JourneyResponse } from './api'
import type { AgentStep } from '../components/agent/agentTypes'

export type PointStatus = 'open' | 'done' | 'skipped'
export type PointType = 'pain_point' | 'recommendation'

export interface ActionPoint {
  id: string
  item: ActionPointItem
  type: PointType
  task: TaskComparison
  status: PointStatus
  severity: 'high' | 'medium'
  ppIndex: number
}

export const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Normalise a raw pain_points/recommendations entry to ActionPointItem.
 *  Handles both old string format (from cached analyses) and the new object format. */
export function toItem(raw: ActionPointItem | string): ActionPointItem {
  if (typeof raw === 'string') return { text: raw, diagrams: [] }
  return raw
}

export function derivePoints(analysis: ComparativeAnalysis): Omit<ActionPoint, 'status'>[] {
  const pts: Omit<ActionPoint, 'status'>[] = []
  for (const task of analysis.task_analyses) {
    const diff = task.difficulty as 'high' | 'medium' | 'low'
    const severity: 'high' | 'medium' = diff === 'high' ? 'high' : 'medium'
    let hasPainPoints = false
    for (let i = 0; i < task.pain_points.length; i++) {
      const item = toItem(task.pain_points[i] as ActionPointItem | string)
      if (!item.text.trim()) continue
      if (/scroll/i.test(item.text)) continue
      pts.push({ id: `pp_${task.task_title}_${i}`, item, type: 'pain_point', task, severity, ppIndex: i })
      hasPainPoints = true
    }
    // Fall back to recommendations when a task has no pain points
    if (!hasPainPoints) {
      for (let i = 0; i < task.recommendations.length; i++) {
        const item = toItem(task.recommendations[i] as ActionPointItem | string)
        if (!item.text.trim()) continue
        pts.push({ id: `rec_${task.task_title}_${i}`, item, type: 'recommendation', task, severity, ppIndex: i })
      }
    }
  }
  return pts.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'pain_point' ? -1 : 1
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  })
}

export function findMatchingRecommendation(painText: string, recs: ActionPointItem[]): ActionPointItem | null {
  if (!recs.length) return null
  const words = painText.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  if (!words.length) return recs[0]
  const scored = recs.map(r => ({ r, score: words.filter(w => r.text.toLowerCase().includes(w)).length }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0].r
}

/** Pick agent thoughts from steps that are keyword-relevant to the action point text. */
export function relevantAgentThoughts(journeys: JourneyResponse[], taskTitle: string, pointText: string, n = 4): string[] {
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

export const ACTION_VERBS: Record<string, string> = {
  click: 'clicked', scroll: 'scrolled on', input: 'typed into', navigate: 'navigated to',
  hover: 'hovered over', submit: 'submitted form on', back: 'went back from',
}

/** Derive readable narrative sentences from human steps relevant to the action point. */
export function relevantHumanNarratives(humanJourneySteps: AgentStep[][], pointText: string, n = 3): string[] {
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
