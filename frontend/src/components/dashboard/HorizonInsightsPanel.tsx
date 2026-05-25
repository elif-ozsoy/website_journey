import { useState, useEffect, useMemo } from 'react'
import type { ComparativeAnalysis, ActionPointItem, JourneyResponse, CompareHighlight } from '../../lib/api'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'

const AGENT_COLOR = '#32494B'
const HUMAN_COLOR = '#881342'

interface HorizonActionPoint {
  id: string
  text: string
  type?: 'ux_issue' | 'agent_gap' | 'human_issue'
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

function LegendSwatch({ color, label, sub }: { color: string; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0, marginTop: 3 }} />
      <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.4 }}>
        <strong>{label}</strong>{sub ? ` — ${sub}` : ''}
      </span>
    </div>
  )
}

export default function HorizonInsightsPanel({
  compareAnalysis,
  compareLoading,
  agentJourneys,
  humanJourneySteps,
  actionContext,
  onClearActionContext,
}: {
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
  actionContext?: { note?: string; explanation?: string; highlight?: CompareHighlight } | null
  onClearActionContext?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'guide' | 'insights'>('insights')

  useEffect(() => {
    if (actionContext) setActiveTab('insights')
  }, [actionContext])

  const actionPoints = useMemo<HorizonActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: HorizonActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        pts.push({
          id: `horizon::${task.task_title}::${item.text.slice(0, 40)}`,
          text: item.text,
          type: item.type,
          taskTitle: task.task_title,
          severity,
        })
      }
    }
    return pts
  }, [compareAnalysis])

  const stats = useMemo(() => {
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
    const agentStepCounts = agentJourneys.map(j => j.total_steps).filter(n => n > 0)
    const humanStepCounts = humanJourneySteps.map(s => s.length).filter(n => n > 0)
    return {
      agent_journey_count: agentJourneys.length,
      human_journey_count: humanJourneySteps.length,
      agent_avg_steps: avg(agentStepCounts),
      human_avg_steps: avg(humanStepCounts),
      graph_type: 'horizon',
      note: 'The horizon graph shows action density (clicks, scrolls, inputs, navigation) over relative journey time (0–100%). Darker bands mean higher activity intensity at that point in the journey.',
    }
  }, [agentJourneys, humanJourneySteps])

  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [expLoading, setExpLoading] = useState<Record<string, boolean>>({})

  const pointIds = actionPoints.map(p => p.id).join(',')
  useEffect(() => {
    if (actionPoints.length === 0) return
    for (const pt of actionPoints) {
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
        <TabBtn label="Action Points" active={activeTab === 'insights'} badge={actionPoints.length} onClick={() => setActiveTab('insights')} />
      </div>

      {/* ──────────────── GUIDE TAB ──────────────── */}
      {activeTab === 'guide' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <SectionLabel>What is a horizon graph?</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Each horizontal strip represents one journey (agent or human). The x-axis is <strong>relative journey time</strong> — 0% = start, 100% = end. The darkness of the fill shows <strong>action density</strong>: how many clicks, scrolls, inputs, and navigations occurred at that moment.
            </p>
          </div>

          <div>
            <SectionLabel>Reading the bands</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Each strip uses the <strong>horizon chart technique</strong>: the density curve is split into three bands. The lightest band shows low activity; each darker band is drawn on top for high-intensity moments. This keeps every strip exactly the same height while still conveying the full range of intensity through darkness.
            </p>
          </div>

          <div>
            <SectionLabel>Comparing AI and human journeys</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              <LegendSwatch color={AGENT_COLOR} label="AI journeys" sub="teal strips" />
              <LegendSwatch color={HUMAN_COLOR} label="Human journeys" sub="rose strips" />
            </div>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Look for differences in <em>where</em> the dark regions appear. If humans have heavy activity early but AI has it late, the task likely has a discovery or navigation friction point.
            </p>
          </div>

          <div>
            <SectionLabel>Clicking a strip</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Click anywhere on a strip to open a detail panel showing all actions recorded within ±5% of that relative time position. Use this to understand <em>what</em> was happening during a dense or sparse region.
            </p>
          </div>

          <div>
            <SectionLabel>Filter buttons</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Use the <strong>All / AI only / Humans only</strong> buttons in the top-right of the graph to focus on one group. All density values are re-scaled relative to the visible journeys so comparisons stay meaningful.
            </p>
          </div>

        </div>
      )}

      {/* ──────────────── ACTION POINTS TAB ──────────────── */}
      {activeTab === 'insights' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* ── Action point context card (from "Verify in diagrams" link) ── */}
          {actionContext && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={onClearActionContext}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-small)', color: 'var(--gray500)', fontWeight: 600, padding: '0 0 2px' }}
              >← All insights</button>
              {actionContext.note && (
                <div style={{ background: 'var(--surface)', border: '1.5px solid var(--brand)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brand)', marginBottom: 6 }}>Action Point</div>
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{actionContext.note}</p>
                </div>
              )}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-primary)', marginBottom: 6 }}>How this diagram connects</div>
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {actionContext.explanation ?? 'The highlighted journey strips show the evidence for this action point.'}
                </p>
              </div>
              {actionContext.highlight?.side && actionContext.highlight.side !== 'both' && (
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray500)' }}>
                  Focus: <strong>{actionContext.highlight.side === 'ai' ? 'AI agent' : 'Human'}</strong> journey strips are highlighted below.
                </p>
              )}
            </div>
          )}

          {compareLoading && (
            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}>
              <Spinner size={12} /> Generating analysis…
            </div>
          )}

          {!compareLoading && actionPoints.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.6 }}>
              {compareAnalysis
                ? 'No issues flagged in this analysis.'
                : 'Run the comparative analysis from the Overview tab to see action points here.'}
            </div>
          )}

          {actionPoints.map((pt, i) => {
            const badge = pt.type ? BADGE_MAP[pt.type] : null
            const explanation = explanations[pt.id]
            const isLoading = expLoading[pt.id]

            return (
              <div key={pt.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray100)', display: 'flex', flexDirection: 'column', gap: 6 }}>
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

                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--gray50)', border: '1px solid var(--gray100)' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gray400)', marginBottom: 5 }}>
                    What to look for in the graph
                  </div>
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
                  ) : (
                    <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic', lineHeight: 1.5 }}>
                      Look for strips with heavy activity (dark bands) at the time position where this issue likely occurs.
                    </p>
                  )}
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