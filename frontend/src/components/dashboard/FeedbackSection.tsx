import { useState } from 'react'
import FeedbackCard from './FeedbackCard'
import { getFeedbackVersions, getInsights } from './feedbackData'
import clsx from 'clsx'

interface Props {
  taskText: string
}

export default function FeedbackSection({ taskText }: Props) {
  const [version, setVersion] = useState<'current' | 'previous'>('current')
  const [menuOpen, setMenuOpen] = useState(false)

  const versions = getFeedbackVersions(taskText)
  const selected = versions[version] ?? versions.current
  const insights = getInsights(taskText)

  return (
    <section className="dash-section">
      <div className="dash-section-hdr">
        <div>
          <h2 className="dash-section-title">AI Feedback</h2>
          <p className="dash-section-sub">{selected.summary}</p>
        </div>
        <div className="dash-version-control">
          <button className="dash-version-btn" onClick={() => setMenuOpen(v => !v)}>
            {selected.label} <span className="dash-version-caret">▾</span>
          </button>
          {menuOpen && (
            <div className="dash-version-menu">
              {(['current', 'previous'] as const).map(v => (
                <button
                  key={v}
                  className={clsx('dash-version-option', version === v && 'active')}
                  onClick={() => { setVersion(v); setMenuOpen(false) }}
                >
                  {versions[v]?.label ?? v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Insights comparison */}
      <div className="dash-insights">
        <div className="dash-insights-col">
          <div className="dash-insights-heading">🤖 Web agents</div>
          <ul className="dash-insights-list">
            {insights.agentBullets.map(b => <li key={b}>{b}</li>)}
          </ul>
        </div>
        <div className="dash-insights-divider" />
        <div className="dash-insights-col">
          <div className="dash-insights-heading">👤 Human testers</div>
          <ul className="dash-insights-list">
            {insights.humanBullets.map(b => <li key={b}>{b}</li>)}
          </ul>
        </div>
      </div>
      <p className="dash-insights-summary">{insights.summary}</p>

      {/* Feedback cards */}
      <div className="fc-list">
        {selected.cards.map(card => (
          <FeedbackCard key={card.title} card={card} />
        ))}
      </div>
    </section>
  )
}
