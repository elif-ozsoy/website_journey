import { useState, useEffect, useMemo } from 'react'
import type { ComparativeAnalysis, ActionPointItem, JourneyResponse } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'

const AGENT_COLOR = '#185FA5'
const HUMAN_COLOR = '#0d9488'
const BOTH_COLOR  = '#1e293b'

interface SankeyActionPoint {
  id: string
  text: string
  type?: 'ux_issue' | 'agent_gap' | 'human_issue'
  reason: string
  taskTitle: string
  severity: 'high' | 'medium'
}

function Spinner({ size = 10 }: { size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      border: `${Math.max(1.5, size / 6)}px solid var(--gray200)`,
      borderTopColor: 'var(--brand)',
      animation: 'spin 0.7s linear infinite',
    }} />
  )
}

const BADGE_MAP: Record<string, { label: string; bg: string; color: string }> = {
  ux_issue:    { label: 'UX Issue',    bg: '#fee2e2', color: '#b91c1c' },
  agent_gap:   { label: 'Agent Gap',   bg: '#dbeafe', color: '#1d4ed8' },
  human_issue: { label: 'Human Issue', bg: '#fef9c3', color: '#92400e' },
}

export default function SankeyInsightsPanel({
  compareAnalysis,
  compareLoading,
  agentJourneys,
  humanJourneySteps,
}: {
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
}) {
  const sankeyPoints = useMemo<SankeyActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: SankeyActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        const sankeyRef = item.diagrams?.find(d => d.view === 'sankey')
        if (!sankeyRef) continue
        pts.push({
          id: `${task.task_title}::${item.text.slice(0, 40)}`,
          text: item.text,
          type: item.type,
          reason: sankeyRef.reason,
          taskTitle: task.task_title,
          severity,
        })
      }
    }
    return pts
  }, [compareAnalysis])

  const stats = useMemo(() => {
    const agentStepCounts = agentJourneys.map(j => j.total_steps).filter(n => n > 0)
    const humanStepCounts = humanJourneySteps.map(s => s.length).filter(n => n > 0)
    const agentPages = new Set<string>()
    for (const j of agentJourneys)
      for (const step of (j.steps as AgentStep[]))
        if (step.url?.startsWith('http')) {
          try { agentPages.add(new URL(step.url).pathname) } catch { agentPages.add(step.url) }
        }
    const humanPages = new Set<string>()
    for (const steps of humanJourneySteps)
      for (const step of steps)
        if (step.url?.startsWith('http')) {
          try { humanPages.add(new URL(step.url).pathname) } catch { humanPages.add(step.url) }
        }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
    return {
      agent_avg_steps: avg(agentStepCounts),
      human_avg_steps: avg(humanStepCounts),
      agent_unique_pages: agentPages.size,
      human_unique_pages: humanPages.size,
      agent_journey_count: agentJourneys.length,
      human_journey_count: humanJourneySteps.length,
    }
  }, [agentJourneys, humanJourneySteps])

  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [expLoading, setExpLoading] = useState<Record<string, boolean>>({})

  const pointIds = sankeyPoints.map(p => p.id).join(',')
  useEffect(() => {
    if (sankeyPoints.length === 0) return
    for (const pt of sankeyPoints) {
      setExpLoading(prev => ({ ...prev, [pt.id]: true }))
      api.explainDiagramLink(pt.text, 'sankey', stats as Record<string, unknown>)
        .then(r => setExplanations(prev => ({ ...prev, [pt.id]: r.explanation })))
        .catch(() => {})
        .finally(() => setExpLoading(prev => ({ ...prev, [pt.id]: false })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointIds])

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

      {/* ── Sankey introduction ── */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray400)', marginBottom: 8 }}>
          How to read this diagram
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.6 }}>
          A <strong>Sankey diagram</strong> maps the flow of navigation across pages. Each rectangle is a unique page; the ribbons between them show page-to-page transitions.
          <strong> Wider ribbons mean more journeys took that path.</strong>
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.6 }}>
          Pages are arranged left-to-right in the order they were first visited. A <strong>⟳</strong> prefix means that page was revisited multiple times in a single journey — a navigation loop.
        </p>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--gray500)', marginBottom: 5 }}>Colour key</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {([
            { color: AGENT_COLOR, label: 'AI agent paths only' },
            { color: HUMAN_COLOR, label: 'Human paths only' },
            { color: BOTH_COLOR,  label: 'Both AI and human' },
          ] as const).map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Action points section header ── */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray400)', marginBottom: 4 }}>
          Action points
        </div>
        <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray500)', lineHeight: 1.5 }}>
          Issues and recommendations whose evidence is visible in this flow diagram. The highlighted paths in the diagram correspond to each point below.
        </p>
      </div>

      {/* ── Loading state ── */}
      {compareLoading && (
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}>
          <Spinner size={12} /> Generating analysis…
        </div>
      )}

      {/* ── Empty state ── */}
      {!compareLoading && sankeyPoints.length === 0 && (
        <div style={{ padding: '14px 16px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.6 }}>
          {compareAnalysis
            ? 'No action points are directly linked to this flow diagram.'
            : 'Run the comparative analysis from the Overview tab to see action points here.'}
        </div>
      )}

      {/* ── Action point cards ── */}
      {sankeyPoints.map((pt, i) => {
        const badge = pt.type ? BADGE_MAP[pt.type] : null
        const explanation = explanations[pt.id]
        const isLoading = expLoading[pt.id]

        return (
          <div key={pt.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray100)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Severity + task */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                background: pt.severity === 'high' ? '#fee2e2' : '#fef3c7',
                color: pt.severity === 'high' ? '#b91c1c' : '#d97706',
              }}>
                {pt.severity.toUpperCase()}
              </span>
              <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pt.taskTitle}
              </span>
            </div>

            {/* Action point text */}
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {i + 1}. {pt.text}
            </p>

            {/* Type badge */}
            {badge && (
              <span style={{
                alignSelf: 'flex-start', fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99,
                background: badge.bg, color: badge.color,
              }}>
                {badge.label}
              </span>
            )}

            {/* Why visible in Sankey */}
            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--gray50)', border: '1px solid var(--gray100)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray400)', marginBottom: 5 }}>
                Why the highlighting makes sense
              </div>
              <p style={{ margin: '0 0 6px', fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>
                {pt.reason}
              </p>
              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                  <Spinner size={9} /> Analysing…
                </div>
              ) : explanation ? (
                <p style={{
                  margin: 0, fontSize: 'var(--fs-small)', color: 'var(--brand)', lineHeight: 1.5,
                  borderLeft: '2px solid var(--brand)', paddingLeft: 7,
                }}>
                  {explanation}
                </p>
              ) : null}
            </div>
          </div>
        )
      })}

      <div style={{ flex: 1 }} />
    </div>
  )
}
