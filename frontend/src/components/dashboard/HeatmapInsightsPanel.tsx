import { useState, useMemo, useEffect, useRef } from 'react'
import type { ComparativeAnalysis, ActionPointItem } from '../../lib/api'

interface HeatmapActionPoint {
  id: string
  text: string
  type?: 'ux_issue' | 'agent_gap' | 'human_issue'
  taskTitle: string
  severity: 'high' | 'medium'
  heatmapReason?: string
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
    <div style={{
      fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: 'var(--gray400)', marginBottom: 6,
    }}>
      {children}
    </div>
  )
}

function ColorSwatch({ color, label, sub }: { color: string; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3, background: color,
        flexShrink: 0, marginTop: 2, border: '1px solid rgba(0,0,0,0.08)',
      }} />
      <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>
        <strong>{label}</strong>{sub ? ` — ${sub}` : ''}
      </span>
    </div>
  )
}

export default function HeatmapInsightsPanel({
  compareAnalysis,
  compareLoading,
  highlightText,
  onClearHighlight,
  activeTaskTitle,
}: {
  compareAnalysis: ComparativeAnalysis | null
  compareLoading: boolean
  highlightText?: string | null
  onClearHighlight?: () => void
  activeTaskTitle?: string | null
}) {
  const [activeTab, setActiveTab] = useState<'guide' | 'insights'>('insights')
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightText) setActiveTab('insights')
  }, [highlightText])

  useEffect(() => {
    if (highlightText && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightText])

  // Collect heatmap-specific action points, filtered to the active task
  const allPoints = useMemo<HeatmapActionPoint[]>(() => {
    if (!compareAnalysis) return []
    const pts: HeatmapActionPoint[] = []
    for (const task of compareAnalysis.task_analyses) {
      if (task.difficulty === 'low') continue
      if (activeTaskTitle && task.task_title !== activeTaskTitle) continue
      const severity: 'high' | 'medium' = task.difficulty === 'high' ? 'high' : 'medium'
      for (const raw of [...task.pain_points, ...task.recommendations]) {
        const item = raw as ActionPointItem
        const heatmapRef = item.diagrams?.find(d => d.view === 'heatmap')
        if (!heatmapRef) continue
        pts.push({
          id: `${task.task_title}::${item.text.slice(0, 40)}`,
          text: item.text,
          type: item.type,
          taskTitle: task.task_title,
          severity,
          heatmapReason: heatmapRef.reason,
        })
      }
    }
    return pts
  }, [compareAnalysis, activeTaskTitle])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        <TabBtn label="Guide" active={activeTab === 'guide'} onClick={() => setActiveTab('guide')} />
        <TabBtn label="Action Points" active={activeTab === 'insights'} badge={allPoints.length} onClick={() => setActiveTab('insights')} />
      </div>

      {/* ──────────────── GUIDE TAB ──────────────── */}
      {activeTab === 'guide' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            <SectionLabel>What is a heatmap?</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              The heatmap overlays a thermal layer on top of each screenshot, showing where clicks and
              visual attention concentrated during the session. Hot spots reveal where users focused most;
              cold areas show sections that were ignored.
            </p>
          </div>

          <div>
            <SectionLabel>Reading the colours</SectionLabel>
            <div style={{ marginTop: 4 }}>
              <ColorSwatch
                color="linear-gradient(90deg, #2563eb 0%, #22c55e 40%, #eab308 70%, #ef4444 100%)"
                label="Blue → Red (agent clicks)"
                sub="low density to high density for AI-agent interactions"
              />
              <ColorSwatch
                color="linear-gradient(90deg, #fce7f3 0%, #f472b6 50%, #be185d 100%)"
                label="Pink → Deep pink (human clicks)"
                sub="low to high density for human tester interactions"
              />
              <ColorSwatch
                color="#22c55e"
                label="Green dots"
                sub="where the AI focused its reading & attention (VLM annotation)"
              />
              <ColorSwatch
                color="#a855f7"
                label="Purple zones"
                sub="overlap areas where both agent and human concentrated"
              />
            </div>
          </div>

          <div>
            <SectionLabel>Navigating multiple pages</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Each dot at the top of the page navigator corresponds to a unique URL visited during the
              session. Click the arrows or dots to step through the pages. The heatmap updates to show
              interaction density for that specific page only.
            </p>
          </div>

          <div>
            <SectionLabel>Click vs attention</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              The solid thermal overlay represents <strong>actual click events</strong> — where users
              physically clicked or tapped. The green dots come from the Vision-Language Model
              (VLM) and mark where the AI was <strong>reading and extracting information</strong>
              from the page, even without clicking. Gaps between the two reveal pages the AI scanned
              but did not interact with.
            </p>
          </div>

          <div>
            <SectionLabel>Filters</SectionLabel>
            <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.7 }}>
              Use the <strong>Filters ▾</strong> button above the heatmap to show or hide individual
              agent runs and human sessions. This lets you isolate a single user's behaviour or
              compare specific runs side-by-side.
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

          {/* Empty state */}
          {!compareLoading && allPoints.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.6 }}>
              {compareAnalysis
                ? 'No heatmap action points for this task.'
                : 'Run the comparative analysis from the Overview tab to see action points here.'}
            </div>
          )}

          {/* Action point cards */}
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {allPoints.map((pt, i) => {
            const isHighlighted = !!(highlightText && pt.text === highlightText)
            return (
              <div
                key={pt.id}
                ref={isHighlighted ? highlightRef : undefined}
                style={{
                  borderRadius: 8, border: isHighlighted ? '2px solid #3b82f6' : '1px solid var(--border)',
                  background: isHighlighted ? '#eff6ff' : 'var(--white)',
                  overflow: 'hidden', flexShrink: 0,
                  transition: 'background 0.3s, border-color 0.3s',
                }}
              >
                <div style={{ padding: '7px 12px', background: 'var(--gray50)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pt.taskTitle}
                  </span>
                  {isHighlighted && (
                    <button onClick={onClearHighlight} style={{ fontSize: '10px', color: 'var(--gray400)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
                  )}
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {i + 1}. {pt.text}
                  </p>
                  {pt.heatmapReason && (
                    <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray500)', lineHeight: 1.5 }}>{pt.heatmapReason}</p>
                  )}
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
