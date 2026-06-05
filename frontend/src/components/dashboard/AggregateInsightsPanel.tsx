import { useState, useEffect, useMemo } from 'react'
import type { ComparativeAnalysis, ActionPointItem, CompareHighlight } from '../../lib/api'
import * as api from '../../lib/api'

const AGGREGATE_VIEWS = ['multiflow', 'human_agg', 'similarity', 'insights', 'policy']

interface AggrActionPoint {
  id: string
  text: string
  type?: 'ux_issue' | 'agent_gap' | 'human_issue'
  reason: string
  taskTitle: string
  severity: 'high' | 'medium'
}

const BADGE_MAP: Record<string, { label: string; bg: string; color: string }> = {
  ux_issue:    { label: 'UX Issue',    bg: '#fee2e2', color: '#b91c1c' },
  agent_gap:   { label: 'Agent Gap',   bg: '#dbeafe', color: '#1d4ed8' },
  human_issue: { label: 'Human Issue', bg: '#fef9c3', color: '#92400e' },
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

export default function AggregateInsightsPanel({
  compareAnalysis,
  compareLoading,
  actionContext,
  onClearActionContext,
}: {
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  actionContext?: { actionPointText?: string; note?: string; taskTitle?: string; evidence?: string; explanation?: string; highlight?: CompareHighlight } | null
  onClearActionContext?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'guide' | 'insights'>('insights')

  useEffect(() => {
    if (actionContext) setActiveTab('insights')
  }, [actionContext])

  const points = useMemo<AggrActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: AggrActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        // Only include items classified by the model (typed) — exclude untyped entries
        if (!item.type) continue
        const ref = item.diagrams?.find(d => AGGREGATE_VIEWS.includes(d.view))
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

  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [expLoading, setExpLoading] = useState<Record<string, boolean>>({})

  const pointIds = points.map(p => p.id).join(',')
  useEffect(() => {
    if (points.length === 0) return
    for (const pt of points) {
      setExpLoading(prev => ({ ...prev, [pt.id]: true }))
      api.explainDiagramLink(pt.text, 'multiflow', {})
        .then(r => setExplanations(prev => ({ ...prev, [pt.id]: r.explanation })))
        .catch(() => {})
        .finally(() => setExpLoading(prev => ({ ...prev, [pt.id]: false })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointIds])

  const pointText = actionContext?.actionPointText ?? actionContext?.note

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <TabBtn label="Guide" active={activeTab === 'guide'} onClick={() => setActiveTab('guide')} />
        <TabBtn label="Action Points" active={activeTab === 'insights'} badge={points.length} onClick={() => setActiveTab('insights')} />
      </div>

      {/* GUIDE TAB */}
      {activeTab === 'guide' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <SectionLabel>Lanes</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {([
                { color: '#881342', label: 'Human', desc: 'states only the human-steered policy visited (top)' },
                { color: '#a855f7', label: 'Shared', desc: 'states visited by both human and AI (middle)' },
                { color: '#32494B', label: 'AI', desc: 'states only the AI policy visited (bottom)' },
                { color: '#6b7280', label: 'Prev Policy', desc: 'previous version\'s policy replayed on the new site (v2+)' },
              ] as const).map(({ color, label, desc }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>
                    <strong style={{ color }}>{label}</strong> — {desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Signals</SectionLabel>
            <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                'Amber loop badge (↻ ×N) — state revisited N times; often signals confusion.',
                'Long solo segments — strategies only one policy found (navigation gap).',
                'Shared states near the end — both policies reach the goal ✓',
              ].map((tip, i) => (
                <li key={i} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>{tip}</li>
              ))}
            </ul>
          </div>

          <div>
            <SectionLabel>Running bots</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.6 }}>
              Click <strong>Run</strong> in the header to launch a live policy bot. The grey <strong style={{ color: '#6b7280' }}>Prev Policy</strong> lane runs automatically when you click <em>Evaluate Updated Version</em>.
            </p>
          </div>

        </div>
      )}

      {/* ACTION POINTS TAB */}
      {activeTab === 'insights' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Action point context card (from "Verify in diagrams" link) */}
          {actionContext && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pointText && (
                <div style={{ background: 'var(--surface)', border: '1.5px solid var(--brand)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brand)', marginBottom: 6 }}>Action Point</div>
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{pointText}</p>
                </div>
              )}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-primary)', marginBottom: 6 }}>How this diagram connects</div>
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {actionContext.explanation ?? 'Look at where the human and AI trajectories diverge in the diagram — that divergence is the evidence for this action point.'}
                </p>
              </div>
            </div>
          )}

          {compareLoading && (
            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}>
              <Spinner size={12} /> Generating analysis…
            </div>
          )}

          {!compareLoading && points.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.6 }}>
              {compareAnalysis
                ? 'No action points are directly linked to this view.'
                : 'Run the comparative analysis from the Overview tab to see action points here.'}
            </div>
          )}

          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {points.map((pt, i) => {
            const explanation = explanations[pt.id]
            const isLoading = expLoading[pt.id]
            return (
              <div key={pt.id} style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--white)', overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ padding: '7px 12px', background: 'var(--gray50)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {pt.taskTitle}
                  </span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {i + 1}. {pt.text}
                  </p>
                  {pt.reason && (
                    <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray500)', lineHeight: 1.5 }}>{pt.reason}</p>
                  )}
                  {isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                      <Spinner size={9} /> Analysing…
                    </div>
                  ) : explanation ? (
                    <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--brand)', lineHeight: 1.5, borderLeft: '2px solid var(--brand)', paddingLeft: 7 }}>
                      {explanation}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
          </div>

          <div style={{ flex: 1 }} />
        </div>
      )}
    </div>
  )
}
