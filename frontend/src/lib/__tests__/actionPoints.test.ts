import { describe, it, expect } from 'vitest'
import {
  derivePoints, findMatchingRecommendation,
  relevantAgentThoughts, relevantHumanNarratives, toItem,
} from '../actionPoints'
import type { ComparativeAnalysis, TaskComparison, JourneyResponse } from '../api'
import type { AgentStep } from '../../components/agent/agentTypes'

// pain_points/recommendations accept legacy string entries at runtime,
// so the helper takes a loose shape and casts.
function makeTask(over: Record<string, unknown> = {}): TaskComparison {
  return {
    task_title: 'Find pricing',
    difficulty: 'high',
    pain_points: [],
    recommendations: [],
    differences: [],
    ...over,
  } as unknown as TaskComparison
}

function makeAnalysis(tasks: TaskComparison[]): ComparativeAnalysis {
  return { task_analyses: tasks } as ComparativeAnalysis
}

describe('toItem', () => {
  it('wraps legacy string entries', () => {
    expect(toItem('old format')).toEqual({ text: 'old format', diagrams: [] })
  })
  it('passes object entries through', () => {
    const item = { text: 'new', diagrams: [] }
    expect(toItem(item)).toBe(item)
  })
})

describe('derivePoints', () => {
  it('derives pain points with stable ids', () => {
    const pts = derivePoints(makeAnalysis([makeTask({ pain_points: ['Button is hidden'] })]))
    expect(pts).toHaveLength(1)
    expect(pts[0].id).toBe('pp_Find pricing_0')
    expect(pts[0].type).toBe('pain_point')
    expect(pts[0].severity).toBe('high')
  })

  it('skips empty and scroll-related pain points', () => {
    const pts = derivePoints(makeAnalysis([makeTask({
      pain_points: ['', '  ', 'User must scroll forever', 'Real issue'],
    })]))
    expect(pts.map(p => p.item.text)).toEqual(['Real issue'])
  })

  it('falls back to recommendations when a task has no pain points', () => {
    const pts = derivePoints(makeAnalysis([makeTask({ recommendations: ['Add a search bar'] })]))
    expect(pts).toHaveLength(1)
    expect(pts[0].type).toBe('recommendation')
    expect(pts[0].id).toBe('rec_Find pricing_0')
  })

  it('does not fall back to recommendations when pain points exist', () => {
    const pts = derivePoints(makeAnalysis([makeTask({
      pain_points: ['Issue'], recommendations: ['Rec'],
    })]))
    expect(pts).toHaveLength(1)
    expect(pts[0].type).toBe('pain_point')
  })

  it('sorts pain points before recommendations, high severity first', () => {
    const pts = derivePoints(makeAnalysis([
      makeTask({ task_title: 'A', difficulty: 'medium', recommendations: ['rec'] }),
      makeTask({ task_title: 'B', difficulty: 'medium', pain_points: ['med issue'] }),
      makeTask({ task_title: 'C', difficulty: 'high', pain_points: ['high issue'] }),
    ]))
    expect(pts.map(p => p.item.text)).toEqual(['high issue', 'med issue', 'rec'])
  })
})

describe('findMatchingRecommendation', () => {
  it('returns null for empty recommendation list', () => {
    expect(findMatchingRecommendation('anything', [])).toBeNull()
  })

  it('returns first rec when pain text has no significant words', () => {
    const recs = [{ text: 'first', diagrams: [] }, { text: 'second', diagrams: [] }]
    expect(findMatchingRecommendation('a b c', recs)).toBe(recs[0])
  })

  it('picks the rec sharing the most significant words', () => {
    const recs = [
      { text: 'Improve color contrast', diagrams: [] },
      { text: 'Make the checkout button larger', diagrams: [] },
    ]
    expect(findMatchingRecommendation('The checkout button is hard to find', recs)).toBe(recs[1])
  })
})

describe('relevantAgentThoughts', () => {
  const journeys = [{
    task_title: 'Find pricing',
    steps: [
      { thought: 'Looking for the pricing page link in navigation' },
      { thought: 'Clicked the about section instead' },
      { thought: 'Looking for the pricing page link in navigation, again' },
    ] as AgentStep[],
  }] as unknown as JourneyResponse[]

  it('returns thoughts matching significant words from the point text', () => {
    const out = relevantAgentThoughts(journeys, 'Find pricing', 'pricing link is hard to locate')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]).toContain('pricing')
  })

  it('deduplicates thoughts with identical first 80 chars', () => {
    const dup = [{
      task_title: 'T',
      steps: [{ thought: 'Same thought here' }, { thought: 'Same thought here' }] as AgentStep[],
    }] as unknown as JourneyResponse[]
    expect(relevantAgentThoughts(dup, 'T', 'thought')).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(relevantAgentThoughts(journeys, 'Find pricing', 'zebra elephant')).toEqual([])
  })
})

describe('relevantHumanNarratives', () => {
  it('builds readable sentences from matching steps', () => {
    const steps: AgentStep[][] = [[
      { url: 'https://x.test/pricing', action_type: 'click', action_details: { label: 'Pricing' } } as unknown as AgentStep,
    ]]
    const out = relevantHumanNarratives(steps, 'pricing page is confusing')
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('clicked')
    expect(out[0]).toContain('/pricing')
  })

  it('returns empty for non-matching steps', () => {
    const steps: AgentStep[][] = [[
      { url: 'https://x.test/about', action_type: 'scroll' } as unknown as AgentStep,
    ]]
    expect(relevantHumanNarratives(steps, 'pricing checkout')).toEqual([])
  })
})
