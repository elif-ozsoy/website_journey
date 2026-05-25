import { useState, useEffect } from 'react'
import * as api from '../../lib/api'

interface Props {
  siteId: string
  taskId?: number
}

function simStyle(sim: number): { color: string; bg: string } {
  if (sim >= 0.7) return { color: 'var(--green)', bg: 'var(--green-pale)' }
  if (sim >= 0.4) return { color: 'var(--amber)', bg: 'var(--amber-pale)' }
  return { color: 'var(--red)', bg: 'var(--red-pale)' }
}

function simLabel(sim: number): string {
  if (sim >= 0.7) return 'High'
  if (sim >= 0.4) return 'Medium'
  return 'Low'
}

export default function SimilarityPanel({ siteId, taskId }: Props) {
  const [items, setItems] = useState<api.JourneySimilarityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getSiteSimilarity(siteId, taskId)
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [siteId, taskId])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
        <span style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block' }} />
        Computing similarity…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, flexDirection: 'column', gap: 8, color: 'var(--red)', fontSize: 'var(--fs-body)' }}>
        <span>Failed to load similarity data</span>
        <span style={{ color: 'var(--gray400)' }}>{error}</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: 24 }}>
        <span style={{ fontSize: 'var(--fs-headline)' }}>∿</span>
        <span style={{ fontWeight: 600, color: 'var(--gray600)' }}>No similarity data yet</span>
        <span>Run both agent and human journeys on the same task to compare behavioural similarity.</span>
      </div>
    )
  }

  const grouped = items.reduce<Record<string, api.JourneySimilarityItem[]>>((acc, item) => {
    (acc[item.task_title] ??= []).push(item)
    return acc
  }, {})

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Behavioural Similarity
        </div>
        <p style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', margin: 0, lineHeight: 1.5 }}>
          Cosine similarity between 16-dim behavioral feature vectors. Higher = more similar navigation patterns.
        </p>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {([['High', '≥ 0.70', 'var(--green)', 'var(--green-pale)'], ['Medium', '0.40 – 0.69', 'var(--amber)', 'var(--amber-pale)'], ['Low', '< 0.40', 'var(--red)', 'var(--red-pale)']] as const).map(([label, range, color, bg]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: bg, color, fontSize: 'var(--fs-small)', fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>{range}</span>
          </div>
        ))}
      </div>

      {Object.entries(grouped).map(([taskTitle, taskItems]) => (
        <div key={taskTitle} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray600)', marginBottom: 8, borderBottom: '1px solid var(--gray100)', paddingBottom: 4 }}>
            {taskTitle}
          </div>

          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '6px 12px', fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            <span>Agent</span>
            <span>Human</span>
            <span style={{ textAlign: 'right' }}>Similarity</span>
          </div>

          {taskItems.map((item, i) => {
            const s = simStyle(item.similarity)
            return (
              <div
                key={i}
                style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '6px 12px', fontSize: 'var(--fs-body)', padding: '5px 0', borderBottom: '1px solid var(--gray100)', alignItems: 'center' }}
              >
                <span style={{ fontFamily: 'var(--font-sans)', color: 'var(--brand)', fontSize: 'var(--fs-small)' }}>#{item.agent_journey_id}</span>
                <span style={{ fontFamily: 'var(--font-sans)', color: 'var(--teal)', fontSize: 'var(--fs-small)' }}>#{item.human_journey_id}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <div style={{ flex: 1, maxWidth: 80, height: 4, borderRadius: 2, background: 'var(--gray100)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.similarity * 100}%`, background: s.color, borderRadius: 2 }} />
                  </div>
                  <span style={{ padding: '1px 8px', borderRadius: 4, background: s.bg, color: s.color, fontSize: 'var(--fs-small)', fontWeight: 700, minWidth: 48, textAlign: 'center' }}>
                    {simLabel(item.similarity)} {(item.similarity * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
