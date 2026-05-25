import { useState } from 'react'
import type { ComparativeAnalysis } from '../../lib/api'

interface Props {
  analysis: ComparativeAnalysis | null
  loading: boolean
  error: string | null
}

export default function CompareAnalysisPanel({ analysis, loading, error }: Props) {
  const [expandedTask, setExpandedTask] = useState<number | null>(0)

  if (loading) {
    return (
      <div className="dash-detail-empty">
        <span style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block', marginBottom: 12 }} />
        <p className="dash-detail-empty-title">Analysing all journeys…</p>
        <p className="dash-detail-empty-sub">Claude is comparing agent and human behaviour across all tasks.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dash-detail-empty">
        <p className="dash-detail-empty-title" style={{ color: 'var(--red)' }}>Analysis failed</p>
        <p className="dash-detail-empty-sub">{error}</p>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="dash-detail-empty">
        <div className="dash-detail-empty-glyph">⇌</div>
        <p className="dash-detail-empty-title">Comparative Analysis</p>
        <p className="dash-detail-empty-sub">Click Compare to run a cross-journey analysis across all agent and human runs.</p>
      </div>
    )
  }

  function diffPill(difficulty: string) {
    const map: Record<string, { color: string; bg: string }> = {
      high:   { color: 'var(--red)',   bg: 'var(--red-pale)' },
      medium: { color: 'var(--amber)', bg: 'var(--amber-pale)' },
      low:    { color: 'var(--green)', bg: 'var(--green-pale)' },
    }
    const s = map[difficulty] ?? { color: 'var(--gray400)', bg: 'var(--gray100)' }
    return (
      <span className="dash-detail-stat-pill" style={{ color: s.color, background: s.bg, textTransform: 'capitalize', fontSize: 'var(--fs-small)', padding: '2px 8px' }}>
        {difficulty}
      </span>
    )
  }

  return (
    <div className="dash-detail fade-in">
      <div className="dash-detail-hdr">
        <div className="dash-detail-badge agent">⇌</div>
        <div>
          <div className="dash-detail-name">Comparative Analysis</div>
          <div className="dash-detail-sub">All agent & human journeys · {analysis.task_analyses.length} task{analysis.task_analyses.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Overall summary */}
      <div className="dash-detail-section">
        <div className="dash-detail-section-title">Overall Summary</div>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6, margin: 0 }}>{analysis.overall_summary}</p>
      </div>

      {/* Per-task collapsible cards */}
      {analysis.task_analyses.map((ta, i) => {
        const isOpen = expandedTask === i
        return (
          <div key={i} className="dash-detail-section" style={{ paddingBottom: 0 }}>
            <button
              onClick={() => setExpandedTask(isOpen ? null : i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 0', textAlign: 'left',
              }}
            >
              <span className="dash-detail-section-title" style={{ flex: 1, margin: 0, fontSize: 'var(--fs-small)' }}>{ta.task_title}</span>
              {diffPill(ta.difficulty)}
              <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginLeft: 2 }}>{isOpen ? '▴' : '▾'}</span>
            </button>

            {isOpen && (
              <div style={{ paddingBottom: 10 }}>
                <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginBottom: 8 }}>
                  {ta.agent_journey_count} agent · {ta.human_journey_count} human
                </div>

                {ta.similarities.length > 0 && (
                  <>
                    <div className="dash-detail-section-title">Similarities</div>
                    <ul className="dash-detail-bullets">{ta.similarities.map((s, j) => <li key={j}>{s}</li>)}</ul>
                  </>
                )}

                {ta.differences.length > 0 && (
                  <>
                    <div className="dash-detail-section-title">Differences</div>
                    <ul className="dash-detail-bullets">{ta.differences.map((s, j) => <li key={j}>{s}</li>)}</ul>
                  </>
                )}

                {ta.agent_strengths?.length > 0 && (
                  <>
                    <div className="dash-detail-section-title">Agent Strengths</div>
                    <ul className="dash-detail-bullets">
                      {ta.agent_strengths.map((s, j) => <li key={j} style={{ color: 'var(--brand)' }}>{s}</li>)}
                    </ul>
                  </>
                )}

                {ta.human_strengths?.length > 0 && (
                  <>
                    <div className="dash-detail-section-title">Human Strengths</div>
                    <ul className="dash-detail-bullets">
                      {ta.human_strengths.map((s, j) => <li key={j} style={{ color: 'var(--teal)' }}>{s}</li>)}
                    </ul>
                  </>
                )}

                {ta.similarity_comparison && (
                  <>
                    <div className="dash-detail-section-title">Similarity Comparison</div>
                    <p style={{ fontSize: 'var(--fs-body)', color: 'var(--gray700)', lineHeight: 1.6, margin: 0 }}>{ta.similarity_comparison}</p>
                  </>
                )}

                {ta.pain_points?.length > 0 && (
                  <>
                    <div className="dash-detail-section-title">Pain Points</div>
                    <ul className="dash-detail-bullets">
                      {ta.pain_points.map((s, j) => <li key={j} style={{ color: 'var(--red)' }}>{typeof s === 'string' ? s : s.text}</li>)}
                    </ul>
                  </>
                )}

                {ta.recommendations?.map((r, j) => (
                  <div key={j} className="dash-detail-card green">
                    <div className="dash-detail-card-body">{typeof r === 'string' ? r : r.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Cross-task insights */}
      {analysis.cross_task_insights?.length > 0 && (
        <div className="dash-detail-section">
          <div className="dash-detail-section-title">Cross-task Insights</div>
          <ul className="dash-detail-bullets">
            {analysis.cross_task_insights.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* Overall recommendations */}
      {analysis.overall_recommendations?.length > 0 && (
        <div className="dash-detail-section">
          <div className="dash-detail-section-title">Overall Recommendations</div>
          {analysis.overall_recommendations.map((r, i) => (
            <div key={i} className="dash-detail-card green">
              <div className="dash-detail-card-body">{r}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
