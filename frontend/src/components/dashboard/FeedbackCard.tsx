import clsx from 'clsx'

export interface FeedbackItem {
  priority: 'high' | 'medium' | 'positive'
  title: string
  body: string
  evidence: string
}

interface Props {
  card: FeedbackItem
}

const ACCENT = { high: 'fc-high', medium: 'fc-med', positive: 'fc-pos' }
const DOT_COLOR = { high: 'var(--red)', medium: 'var(--amber)', positive: 'var(--green)' }
const LABEL = { high: 'High priority', medium: 'Medium priority', positive: 'Positive signal' }

export default function FeedbackCard({ card }: Props) {
  return (
    <div className={clsx('fc', ACCENT[card.priority])}>
      <div className="fc-left">
        <span className="fc-dot" style={{ background: DOT_COLOR[card.priority] }} />
      </div>
      <div className="fc-right">
        <div className="fc-hdr">
          <span className="fc-title">{card.title}</span>
          <span className="fc-label">{LABEL[card.priority]}</span>
        </div>
        <p className="fc-body">{card.body}</p>
        <p className="fc-evidence"><span>Evidence:</span> {card.evidence}</p>
      </div>
    </div>
  )
}
