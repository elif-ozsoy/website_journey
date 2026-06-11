import type { AgentStep } from '../agent/agentTypes'

/**
 * Aggregates multiple journeys into a single "representative" journey
 * showing the most common action/page sequences.
 *
 * Algorithm:
 * 1. Group journeys by their page URL sequences
 * 2. Find the most common sequence
 * 3. For each position in that sequence, pick the most common action
 * 4. Return a single synthesized journey
 */

interface PageSequenceStats {
  pages: string[]
  frequency: number
  actions: AgentStep[][]
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

/**
 * Extracts the page sequence from a journey (unique URLs visited)
 */
function getPageSequence(steps: AgentStep[]): string[] {
  const seen = new Set<string>()
  const sequence: string[] = []
  for (const step of steps) {
    const normalized = normalizeUrl(step.url)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      sequence.push(normalized)
    }
  }
  return sequence
}

/**
 * Groups journeys by their page sequence
 */
function groupByPageSequence(journeys: AgentStep[][]): Map<string, PageSequenceStats> {
  const groups = new Map<string, PageSequenceStats>()

  journeys.forEach(journey => {
    const sequence = getPageSequence(journey)
    const key = JSON.stringify(sequence)

    if (!groups.has(key)) {
      groups.set(key, {
        pages: sequence,
        frequency: 0,
        actions: sequence.map(() => []),
      })
    }

    const group = groups.get(key)!
    group.frequency++

    // Group steps by their page
    let pageIdx = 0
    let currentPage = normalizeUrl(journey[0]?.url || '')

    journey.forEach(step => {
      const stepPage = normalizeUrl(step.url)
      if (stepPage !== currentPage) {
        pageIdx++
        currentPage = stepPage
      }
      if (pageIdx < group.actions.length) {
        group.actions[pageIdx].push(step)
      }
    })
  })

  return groups
}

/**
 * Picks the most common action at a given position
 */
function getMostCommonAction(steps: AgentStep[]): AgentStep | null {
  if (steps.length === 0) return null

  // Count action types and pick the most common
  const actionCounts = new Map<string, { step: AgentStep; count: number }>()

  steps.forEach(step => {
    const d = step.action_details as Record<string, unknown>
    const key = `${step.action_type}:${d?.element_selector || d?.input_text || ''}`
    if (!actionCounts.has(key)) {
      actionCounts.set(key, { step, count: 0 })
    }
    actionCounts.get(key)!.count++
  })

  let maxCount = 0
  let mostCommon: AgentStep | null = null

  actionCounts.forEach(({ step, count }) => {
    if (count > maxCount) {
      maxCount = count
      mostCommon = step
    }
  })

  return mostCommon
}

/**
 * Aggregates multiple journeys into a single representative journey
 */
export function aggregateJourneys(journeys: AgentStep[][]): AgentStep[] {
  if (journeys.length === 0) return []
  if (journeys.length === 1) return journeys[0]

  // Group by page sequence and pick the most common
  const groups = groupByPageSequence(journeys)
  let mostCommonSequence: PageSequenceStats | null = null
  let maxFreq = 0

  groups.forEach(group => {
    if (group.frequency > maxFreq) {
      maxFreq = group.frequency
      mostCommonSequence = group
    }
  })

  if (!mostCommonSequence) return journeys[0]

  // Build aggregated journey by picking most common action at each position
  const aggregated: AgentStep[] = []
  let stepNumber = 1
  const commonSeq = mostCommonSequence as PageSequenceStats

  commonSeq.actions.forEach((pageActions, _pageIdx) => {
    const mostCommon = getMostCommonAction(pageActions)
    if (mostCommon) {
      aggregated.push({
        ...mostCommon,
        step_number: stepNumber++,
      })
    }
  })

  return aggregated
}

/**
 * Calculates flow statistics for a journey
 */
export interface FlowStats {
  totalSteps: number
  uniquePages: number
  actionCounts: Record<string, number>
  commonPath: string[]
}

export function getFlowStats(steps: AgentStep[]): FlowStats {
  const actionCounts: Record<string, number> = {}
  const uniquePages = new Set<string>()

  steps.forEach(step => {
    actionCounts[step.action_type] = (actionCounts[step.action_type] || 0) + 1
    uniquePages.add(normalizeUrl(step.url))
  })

  return {
    totalSteps: steps.length,
    uniquePages: uniquePages.size,
    actionCounts,
    commonPath: getPageSequence(steps),
  }
}

/**
 * Compares two aggregated flows and highlights differences
 */
export interface FlowComparison {
  humanAgg: AgentStep[]
  aiAgg: AgentStep[]
  humanStats: FlowStats
  aiStats: FlowStats
  maxSteps: number
}

export function compareAggregatedFlows(
  humanJourneys: AgentStep[][],
  aiJourneys: AgentStep[][],
): FlowComparison {
  const humanAgg = aggregateJourneys(humanJourneys)
  const aiAgg = aggregateJourneys(aiJourneys)
  const humanStats = getFlowStats(humanAgg)
  const aiStats = getFlowStats(aiAgg)

  return {
    humanAgg,
    aiAgg,
    humanStats,
    aiStats,
    maxSteps: Math.max(humanAgg.length, aiAgg.length),
  }
}
