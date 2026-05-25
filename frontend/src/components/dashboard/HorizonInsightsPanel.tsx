import { useState, useEffect, useMemo } from 'react'
import type { ComparativeAnalysis, ActionPointItem, JourneyResponse } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'

interface HorizonActionPoint {
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

function TabBtn({ label, active, badge, onClick }: {
  label: string; active: boolean; badge?: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '9px 8px', border: 'none', cursor: 'pointer',
        background: 'transparent', fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-small)', fontWeight: active ? 700 : 500,
        color: active ? 'var(--brand)' : 'var(--gray400)',
        borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
        transition: 'color 0.13s, border-color 0.13s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      }}
    >
      {label}
      {badge != null && badge > 0 && (
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '0 5px', borderRadius: 99,
          background: active ? 'var(--brand)' : 'var(--gray200)',
          color: active ? '#fff' : 'var(--gray500)',
          lineHeight: '16px', minWidth: 16, textAlign: 'center',
        }}>{badge}</span>
      )}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray400)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

export default function HorizonInsightsPanel({
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
  const [activeTab, setActiveTab] = useState<'guide' | 'insights'>('insights')

  // ── Action points linked to the horizon diagram ───────────────────
  const horizonPoints = useMemo<HorizonActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: HorizonActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        const ref = item.diagrams?.find(d => d.view === 'horizon')
        if (!ref) continue
        pts.push({
          id: `${task.task_title}::${item.text.slice(0, 40)}`,
          text: item.text,
          type: item.type,
          reason: ref.reason,
          taskTitle: task.task_title,
          severity,
        })
      }
    }
    return pts
  }, [compareAnalysis])

  // ── Stats for LLM diagram-link explanations ────────────────────
  const stats = useMemo(() => {
    const agentStepCounts = agentJourneys.map(j => j.total_steps).filter(n => n > 0)
    const humanStepCounts = humanJourneySteps.map(s => s.length).filter(n => n > 0)
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
    return {
      agent_avg_steps: avg(agentStepCounts),
      human_avg_steps: avg(humanStepCounts),
      agent_journey_count: agentJourneys.length,
      human_journey_count: humanJourneySteps.length,
    }
  }, [agentJourneys, humanJourneySteps])

  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [expLoading, setExpLoading] = useState<Record<string, boolean>>({})

  const pointIds = horizonPoints.map(p => p.id).join(',')
  useEffect(() => {
    if (horizonPoints.length === 0) return
    for (const pt of horizonPoints) {
      setExpLoading(prev => ({ ...prev, [pt.id]: true }))
      api.explainDiagramLink(pt.text, 'horizon', stats as Record<string, unknown>)
        .then(r => setExplanations(prev => ({ ...prev, [pt.id]: r.explanation })))
        .catch(() => {})
        .finally(() => setExpLoading(prev => ({ ...prev, [pt.id]: false })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointIds])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <TabBtn label="Guide" active={activeTab === 'guide'} onClick={() => setActiveTab('guide')} />
        <TabBtn label="Action Points" active={activeTab === 'insights'} badge={horizonPoints.length} onClick={() => setActiveTab('insights')} />
      </div>

      {/* ──────────────── GUIDE TAB ──────────────── */}
      {activeTab === 'guide' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <SectionLabel>What is a horizon graph?</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              A horizon graph shows <strong>action density over the relative time</strong> of each journey. Every horizontal strip represents one agent run or human session. The X-axis is the journey's timeline from start (0%) to finish (100%); the Y-axis encodes how concentrated activity was at each moment.
            </p>
          </div>

          <div>
            <SectionLabel>Reading the colour bands</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Each strip is drawn as <strong>stacked colour bands</strong> — this is the "horizon" technique. Instead of a tall spike, three bands of the same colour are layered on top of each other at a fixed height. <strong>Darker = more intense activity.</strong> A uniformly light strip means evenly spread actions; a very dark region means many clicks, scrolls, or inputs were packed into a short window.
            </p>
          </div>

          <div>
            <SectionLabel>Agent vs Human colours</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              <strong style={{ color: '#4f46e5' }}>Indigo / violet</strong> strips are AI agent runs. <strong style={{ color: '#0891b2' }}>Cyan / teal</strong> strips are human sessions. Compare where the dark regions appear across the two groups — if agents front-load activity (dark on the left) while humans spread it evenly, that suggests the agent is guessing early rather than reading the page.
            </p>
          </div>

          <div>
            <SectionLabel>Clicking a strip</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Click anywhere on a strip to open a <strong>step detail modal</strong> showing every action recorded within ±5% of that time position. Use this to verify what was actually happening at a high-density peak.
            </p>
          </div>

        </div>
      )}

      {/* ──────────────── ACTION POINTS TAB ──────────────── */}
      {activeTab === 'insights' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Loading */}
          {compareLoading && (
            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}>
              <Spinner size={12} /> Generating analysis…
            </div>
          )}

          {/* ── Empty state ── */}
          {!compareLoading && horizonPoints.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.6 }}>
              {compareAnalysis
                ? 'No action points are directly linked to this horizon graph.'
                : 'Run the comparative analysis from the Overview tab to see action points here.'}
            </div>
          )}

          {/* ── Action point cards ── */}
          {horizonPoints.map((pt, i) => {
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

                {badge && (
                  <span style={{
                    alignSelf: 'flex-start', fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99,
                    background: badge.bg, color: badge.color,
                  }}>
                    {badge.label}
                  </span>
                )}

                {/* What to look for in the diagram */}
                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--gray50)', border: '1px solid var(--gray100)' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray400)', marginBottom: 5 }}>
                    What to look for in the graph
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
      )}
    </div>
  )
}
