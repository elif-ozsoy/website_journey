import { useState, useEffect, useMemo } from 'react'
import type { ComparativeAnalysis, ActionPointItem, JourneyResponse } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'
import type { NodeDivergence } from './SankeyDiagram'

const AGENT_COLOR = '#185FA5'
const HUMAN_COLOR = '#0d9488'

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

function LegendRow({ color, label, sub }: { color: string; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0, marginTop: 3 }} />
      <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.4 }}>
        <strong>{label}</strong>{sub ? ` — ${sub}` : ''}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray400)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export default function SankeyInsightsPanel({
  compareAnalysis,
  compareLoading,
  agentJourneys,
  humanJourneySteps,
  divergences = [],
}: {
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
  divergences?: NodeDivergence[]
}) {
  const [activeTab, setActiveTab] = useState<'guide' | 'insights'>('insights')

  // ── Action points linked to the Sankey diagram ───────────────────
  const sankeyPoints = useMemo<SankeyActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: SankeyActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        const ref = item.diagrams?.find(d => d.view === 'sankey')
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
    const divergentMilestones = divergences.map(d =>
      `${d.nodeName} (${d.groups.map(g => `"${truncate(g.label, 30)}"`).join(' vs ')})`
    )
    return {
      agent_avg_steps: avg(agentStepCounts),
      human_avg_steps: avg(humanStepCounts),
      agent_journey_count: agentJourneys.length,
      human_journey_count: humanJourneySteps.length,
      divergence_count: divergences.length,
      divergent_milestones: divergentMilestones.slice(0, 4).join('; ') || null,
    }
  }, [agentJourneys, humanJourneySteps, divergences])

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

  const hasDivergence = divergences.length > 0
  const insightCount = sankeyPoints.length + (hasDivergence ? 1 : 0)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <TabBtn label="Guide" active={activeTab === 'guide'} onClick={() => setActiveTab('guide')} />
        <TabBtn label="Action Points" active={activeTab === 'insights'} badge={insightCount} onClick={() => setActiveTab('insights')} />
      </div>

      {/* ──────────────── GUIDE TAB ──────────────── */}
      {activeTab === 'guide' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <SectionLabel>What is a Sankey diagram?</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              A Sankey diagram shows how AI agents and humans moved through the website's milestone stages. Each <strong>rectangle is a milestone</strong> (e.g. navigation click, page view, form input); the curved ribbons between them show how journeys progressed from one stage to the next.
            </p>
          </div>

          <div>
            <SectionLabel>Reading ribbon widths</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Ribbon width reflects <strong>how many navigation steps</strong> were recorded between two milestones — not the number of distinct journeys. A single session that spent many steps transitioning between two stages will produce a wide ribbon.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Node colours</SectionLabel>
            <LegendRow color={AGENT_COLOR} label="AI agent" sub="milestone reached only by agent runs" />
            <LegendRow color={HUMAN_COLOR} label="Human" sub="milestone reached only by human sessions" />
            <LegendRow color="#1e293b" label="Both" sub="milestone reached by both AI and humans" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Special indicators</SectionLabel>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.6 }}>
              <strong>⟳ prefix</strong> — that milestone was revisited more than twice in a single journey (a loop). The loop node is shown separately to keep the diagram readable.
            </div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.6 }}>
              <strong style={{ color: '#f59e0b' }}>⬛ exit</strong> — the milestone had no outgoing transitions; that journey ended here.
            </div>
          </div>

          <div>
            <SectionLabel>Path divergence</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              When multiple journeys reach the same milestone but then interact with <strong>different elements</strong> to continue, that node is marked with a{' '}
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 14, height: 14, borderRadius: '50%', background: '#f59e0b',
                color: '#fff', fontSize: '0.6rem', fontWeight: 800, verticalAlign: 'middle',
              }}>⚡</span>{' '}
              amber badge. This is a <em>divergence</em> — not just one journey splitting in two, but potentially many journeys each taking a distinct path through that milestone. The panel to the right lists every divergent milestone and which element each journey clicked.
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

          {/* ── Divergence card ── */}
          {hasDivergence && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, borderRadius: '50%', background: '#f59e0b',
                  color: '#fff', fontSize: '0.6rem', fontWeight: 800, flexShrink: 0,
                }}>⚡</span>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#fef3c7', color: '#92400e' }}>
                  {divergences.length} DIVERGENCE{divergences.length !== 1 ? 'S' : ''} DETECTED
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>
                At {divergences.length} milestone{divergences.length !== 1 ? 's' : ''}, different journeys interacted with different elements. Look for the ⚡ badge on nodes in the diagram.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {divergences.map(d => (
                  <div key={d.nodeId} style={{
                    paddingLeft: 10, borderLeft: '2px solid #fbbf24',
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}>
                    <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: '#78350f' }}>
                      {d.nodeName} · {d.groups.length} paths
                    </div>
                    {d.groups.map((g, gi) => (
                      <div key={gi} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                        <span style={{ color: '#b45309', fontWeight: 700, flexShrink: 0 }}>•</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>"{truncate(g.label, 44)}"</span>
                        <span style={{ color: 'var(--gray400)', flexShrink: 0 }}>({g.visits.length})</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
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
                    What to look for in the diagram
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
