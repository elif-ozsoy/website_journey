import { useState } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import ScreenshotGallery from '../agent/ScreenshotGallery'

interface Props {
  steps: AgentStep[] | null
  sourceLabel: string
  loading?: boolean
}

export default function JourneyView({ steps, sourceLabel, loading = false }: Props) {
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const hasSteps = !!steps && steps.length > 0
  const uniquePages = hasSteps ? new Set(steps!.map((s) => s.url)).size : 0

  return (
    <div className="journey-view">
      <div style={{ borderBottom: '1px solid var(--gray100)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div className="journey-header-title">Step Screenshots</div>
          <div className="journey-header-sub">
            {hasSteps
              ? `${steps!.length} steps across ${uniquePages} page${uniquePages !== 1 ? 's' : ''}.`
              : 'No journey data yet — run an agent or select a session.'}
          </div>
        </div>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-pale)', padding: '4px 12px', borderRadius: 999, flexShrink: 0 }}>
          {sourceLabel}
        </div>
      </div>

      {loading ? (
        <div className="journey-empty">Loading journey data…</div>
      ) : !hasSteps ? (
        <div className="journey-empty">No screenshots captured yet.</div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ScreenshotGallery
            steps={steps!}
            selectedStep={selectedStep}
            onSelectStep={setSelectedStep}
          />
        </div>
      )}
    </div>
  )
}
