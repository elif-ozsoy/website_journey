import { useState, useRef, useEffect } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import type { FlowStats } from './journeyAggregation'

interface Props {
  humanFlow: AgentStep[]
  aiFlow: AgentStep[]
  humanStats: FlowStats
  aiStats: FlowStats
  maxSteps: number
}

const ACTION_COLORS: Record<string, string> = {
  click_element: '#185FA5',
  input_text: '#059669',
  go_to_url: '#d97706',
  scroll: '#0891b2',
  go_back: '#f43f5e',
  extract_content: '#7c3aed',
  done: '#16a34a',
  unknown: '#475569',
}

const ACTION_ICONS: Record<string, string> = {
  click_element: '🖱️',
  input_text: '⌨️',
  go_to_url: '🔗',
  scroll: '↕️',
  go_back: '←',
  extract_content: '📋',
  done: '✓',
  search_google: '🔍',
  open_tab: '🗂️',
  switch_tab: '⇄',
}

function aColor(t: string) {
  return ACTION_COLORS[t] ?? '#475569'
}

function aIcon(t: string) {
  return ACTION_ICONS[t] ?? '⚡'
}

function StepCard({ step, index }: { step: AgentStep; index: number }) {
  const screenshotSrc = step.screenshot_url ?? (step.screenshot_base64 ? `data:image/png;base64,${step.screenshot_base64}` : null)
  const pageLabel = (() => {
    try {
      const u = new URL(step.url)
      return u.pathname.replace(/\/$/, '') || '/'
    } catch {
      return step.url.slice(0, 30)
    }
  })()

  return (
    <div
      style={{
        flexShrink: 0,
        width: 200,
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Step number badge */}
      <div
        style={{
          padding: '8px 12px',
          background: aColor(step.action_type),
          color: '#fff',
          fontWeight: 700,
          fontSize: 'var(--fs-small)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{aIcon(step.action_type)}</span>
        <span>Step {index + 1}</span>
      </div>

      {/* Screenshot */}
      <div
        style={{
          height: 120,
          background: '#f5f5f5',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {screenshotSrc ? (
          <img
            src={screenshotSrc}
            alt={`Step ${index + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: 'var(--fs-body)', color: 'var(--gray400)' }}>No screenshot</span>
        )}
      </div>

      {/* Action info */}
      <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
          {step.action_type.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 3, flexGrow: 1 }}>
          {pageLabel}
        </div>
      </div>
    </div>
  )
}

function FlowLane({
  label,
  steps,
  stats,
  color,
}: {
  label: string
  steps: AgentStep[]
  stats: FlowStats
  color: 'blue' | 'teal'
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    function updateScrollButtons() {
      if (!container) return
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 10)
    }

    updateScrollButtons()
    container.addEventListener('scroll', updateScrollButtons)
    window.addEventListener('resize', updateScrollButtons)

    return () => {
      container.removeEventListener('scroll', updateScrollButtons)
      window.removeEventListener('resize', updateScrollButtons)
    }
  }, [])

  function scroll(direction: 'left' | 'right') {
    const container = scrollContainerRef.current
    if (!container) return
    const amount = 250
    container.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
  }

  const colorVars =
    color === 'blue'
      ? { bg: 'var(--brand-pale)', label: 'var(--brand)', border: 'var(--accent)' }
      : { bg: '#ecfdf5', label: '#0d9488', border: '#10b981' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          background: colorVars.bg,
          borderBottom: `2px solid ${colorVars.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: colorVars.label }}>{label}</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.totalSteps} step{stats.totalSteps !== 1 ? 's' : ''} · {stats.uniquePages} page
              {stats.uniquePages !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable steps container */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {/* Scroll buttons */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 40,
              background: 'linear-gradient(to right, rgba(255,255,255,0.8) 0%, transparent 100%)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              color: 'var(--text-primary)',
            }}
          >
            ←
          </button>
        )}

        {/* Scrollable area */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            display: 'flex',
            gap: 12,
            padding: '12px 16px',
            scrollBehavior: 'smooth',
          }}
        >
          {steps.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body)',
              }}
            >
              No steps
            </div>
          ) : (
            steps.map((step, idx) => <StepCard key={idx} step={step} index={idx} />)
          )}
        </div>

        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 40,
              background: 'linear-gradient(to left, rgba(255,255,255,0.8) 0%, transparent 100%)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              color: 'var(--text-primary)',
            }}
          >
            →
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Side-by-side comparison of aggregated human vs AI flows
 */
export default function HorizontalFlowComparison({
  humanFlow,
  aiFlow,
  humanStats,
  aiStats,
}: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    >
      {/* Title bar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#f9f9f9' }}>
        <h3 style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Aggregated Flow Comparison
        </h3>
        <p style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 4, margin: 0 }}>
          Each lane shows the most common moves across all sessions of that type.
        </p>
      </div>

      {/* Two-lane layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Human flow lane */}
        <FlowLane label="Human Users" steps={humanFlow} stats={humanStats} color="teal" />

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--border)' }} />

        {/* AI flow lane */}
        <FlowLane label="AI Agent" steps={aiFlow} stats={aiStats} color="blue" />
      </div>
    </div>
  )
}
