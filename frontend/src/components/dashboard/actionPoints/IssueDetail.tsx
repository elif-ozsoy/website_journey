import { useState, useEffect, useMemo } from 'react'
import type { JourneyResponse, ActionPointItem, DiagramRef } from '../../../lib/api'
import * as api from '../../../lib/api'
import type { AgentStep } from '../../agent/agentTypes'
import {
  type ActionPoint, type PointStatus,
  toItem, findMatchingRecommendation, relevantAgentThoughts, relevantHumanNarratives,
} from '../../../lib/actionPoints'
import { Label, CollapsibleSection, RichText, Spinner } from './ui'

const DIAGRAM_LABELS: Record<string, string> = {
  compare: 'AI vs Human',
  sankey: 'Journey Flow',
  horizon: 'Horizon Graph',
  heatmap: 'Page Heatmap',
  multiflow: 'All Flows',
  similarity: 'Journey Similarity',
  comparative: 'Comparative Analysis',
  insights: 'Insights',
  human_agg: 'Human Aggregate',
  policy: 'Policy Bot',
}

/** Inline textarea editor used for both the issue text and the suggestion. */
function InlineEditor({ draft, onChange, onSave, onCancel }: {
  draft: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        autoFocus
        value={draft}
        onChange={e => onChange(e.target.value)}
        rows={3}
        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: '1.5px solid var(--accent)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-body)', lineHeight: 1.6, resize: 'vertical', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onSave} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-small)', fontWeight: 700, cursor: 'pointer' }}>Save</button>
        <button onClick={onCancel} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 'var(--fs-small)', color: 'var(--gray600)', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

/** Pencil button that is invisible until hovered. */
function EditPencil({ onClick, title, marginTop = 2 }: { onClick: () => void; title: string; marginTop?: number }) {
  return (
    <button onClick={onClick} title={title} style={{ flexShrink: 0, marginTop, padding: '2px 5px', borderRadius: 5, border: '1px solid transparent', background: 'none', color: 'transparent', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--gray600)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'transparent' }}
    >✎</button>
  )
}

export function IssueDetail({ point, idx, total, status, agentJourneys, humanJourneySteps, ratingsSummary, onDone, onSkip, onPrev, onNext, onRemove, onEditText, onEditRec, editedRecText, onNavigateTo, compact = false }: {
  point: ActionPoint; idx: number; total: number; status: PointStatus
  agentJourneys: JourneyResponse[]
  humanJourneySteps: AgentStep[][]
  ratingsSummary: api.RatingsSummary | null
  onDone: () => void; onSkip: () => void; onPrev: () => void; onNext: () => void
  onRemove: () => void
  onEditText: (text: string) => void
  onEditRec: (text: string) => void
  editedRecText?: string
  onNavigateTo: (tab: string, view?: string, noteCtx?: { actionPointText: string; taskTitle: string; evidence: string }, diagramRef?: DiagramRef, pointText?: string) => void
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [editingRec, setEditingRec] = useState(false)
  const [editRecDraft, setEditRecDraft] = useState('')
  useEffect(() => { setEditing(false); setEditDraft(''); setEditingRec(false); setEditRecDraft('') }, [point.id])
  const isPain = point.type === 'pain_point'
  // For pain_points: pick the recommendation that best matches the issue text.
  // For recommendation-type points: the item itself is the suggested action.
  const relevantRec: ActionPointItem | null = isPain
    ? (point.item.suggested_action
        ? { text: point.item.suggested_action, diagrams: [] }
        : findMatchingRecommendation(point.item.text, point.task.recommendations.map(r => toItem(r as ActionPointItem | string))))
    : point.item

  const diagrams = point.item.diagrams ?? []

  const agentThoughts = useMemo(
    () => relevantAgentThoughts(agentJourneys, point.task.task_title, point.item.text),
    [agentJourneys, point.task.task_title, point.item.text],
  )
  const humanNarratives = useMemo(
    () => relevantHumanNarratives(humanJourneySteps, point.item.text),
    [humanJourneySteps, point.item.text],
  )
  const humanComments = ratingsSummary?.comments ?? []
  // Used to gate the explain-human API call — needs actual narratives/comments to send.
  const hasHumanData = humanNarratives.length > 0 || humanComments.length > 0

  const [agentExplanation, setAgentExplanation] = useState<string | null>(point.item.agent_explanation ?? null)
  const [agentExpLoading, setAgentExpLoading] = useState(false)
  const [humanExplanation, setHumanExplanation] = useState<string | null>(point.item.human_explanation ?? null)
  const [humanExpLoading, setHumanExpLoading] = useState(false)

  useEffect(() => {
    // Use pre-generated explanations if available
    if (point.item.agent_explanation) {
      setAgentExplanation(point.item.agent_explanation)
      setAgentExpLoading(false)
    } else if (agentThoughts.length > 0) {
      setAgentExplanation(null)
      setAgentExpLoading(true)
      api.explainAgentPerspective(point.item.text, point.task.task_title, agentThoughts)
        .then(r => setAgentExplanation(r.explanation))
        .catch(() => setAgentExplanation(null))
        .finally(() => setAgentExpLoading(false))
    } else {
      setAgentExplanation(null)
    }

    if (point.item.human_explanation) {
      setHumanExplanation(point.item.human_explanation)
      setHumanExpLoading(false)
    } else if (hasHumanData) {
      setHumanExplanation(null)
      setHumanExpLoading(true)
      api.explainHuman(point.item.text, point.task.task_title, humanNarratives, humanComments, ratingsSummary)
        .then(r => setHumanExplanation(r.explanation))
        .catch(() => setHumanExplanation(null))
        .finally(() => setHumanExpLoading(false))
    } else {
      setHumanExplanation(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.id, point.item.text])

  const hasBullets = !!(point.item.agent_bullets?.length || point.item.human_bullets?.length)
  const hasPerspectives = !hasBullets && (agentThoughts.length > 0 || hasHumanData || !!point.item.agent_explanation || !!point.item.human_explanation)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: compact ? '14px 16px' : '16px 18px', gap: 12, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* Task */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'nowrap', minWidth: 0, borderBottom: '1.5px solid var(--border)', paddingBottom: 6 }}>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>Task:</span>
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{point.task.task_title}</span>
      </div>

      {/* Issue text — only for pain points; recommendations show as Suggested action directly */}
      {isPain && (
        editing ? (
          <InlineEditor
            draft={editDraft}
            onChange={setEditDraft}
            onSave={() => { if (editDraft.trim()) onEditText(editDraft.trim()); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <p style={{ margin: 0, flex: 1, fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{point.item.text}</p>
            <EditPencil title="Edit text" onClick={() => { setEditDraft(point.item.text); setEditing(true) }} />
          </div>
        )
      )}

      {/* Suggested action */}
      {relevantRec ? (
        <CollapsibleSection label="Suggested action" defaultOpen>
          {editingRec ? (
            <InlineEditor
              draft={editRecDraft}
              onChange={setEditRecDraft}
              onSave={() => { if (editRecDraft.trim()) onEditRec(editRecDraft.trim()); setEditingRec(false) }}
              onCancel={() => setEditingRec(false)}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ flex: 1, padding: '9px 12px', borderRadius: 8, background: 'var(--brand-pale)', border: '1px solid var(--accent-soft)' }}>
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--brand)', lineHeight: 1.55 }}>{editedRecText ?? relevantRec.text}</p>
              </div>
              <EditPencil title="Edit suggestion" marginTop={8} onClick={() => { setEditRecDraft(editedRecText ?? relevantRec.text); setEditingRec(true) }} />
            </div>
          )}
        </CollapsibleSection>
      ) : isPain && (
        <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>
          Re-run the analysis to generate a suggested action for this issue.
        </p>
      )}

      {/* Human vs Agent behaviour bullets */}
      {(point.item.human_bullets?.length || point.item.agent_bullets?.length || humanJourneySteps.length > 0) ? (
        <CollapsibleSection label="Behaviour comparison">
          <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '6px 10px', borderRight: '1px solid var(--border)', background: 'var(--gray50)' }}>
                <Label>Human</Label>
              </div>
              <div style={{ padding: '6px 10px', background: 'var(--gray50)' }}>
                <Label>Agent</Label>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <ul style={{ margin: 0, padding: '8px 10px 8px 22px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(point.item.human_bullets ?? []).map((b, i) => (
                  <li key={i} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>{b}</li>
                ))}
                {!point.item.human_bullets?.length && (
                  <li style={{ listStyle: 'none', fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data</li>
                )}
              </ul>
              <ul style={{ margin: 0, padding: '8px 10px 8px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(point.item.agent_bullets ?? []).map((b, i) => (
                  <li key={i} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>{b}</li>
                ))}
                {!point.item.agent_bullets?.length && (
                  <li style={{ listStyle: 'none', fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No agent data</li>
                )}
              </ul>
            </div>
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Key finding */}
      {point.task.differences[0] && (
        <CollapsibleSection label="Key finding from analysis">
          <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}>{point.task.differences[0]}</p>
        </CollapsibleSection>
      )}

      {/* Perspectives: agent explanation + human explanation */}
      {hasPerspectives && (
        <CollapsibleSection label="Perspectives">
          <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '6px 10px', borderRight: '1px solid var(--border)', background: 'var(--gray50)' }}>
                <Label>Agent</Label>
              </div>
              <div style={{ padding: '6px 10px', background: 'var(--gray50)' }}>
                <Label>Human</Label>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '8px 10px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start' }}>
                {agentThoughts.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No matching thoughts found</p>
                ) : agentExpLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                    <Spinner size={9} /> Analysing…
                  </div>
                ) : agentExplanation ? (
                  <div style={{ borderLeft: '2px solid var(--brand)', paddingLeft: 7 }}>
                    <RichText text={agentExplanation} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.55 }} />
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No matching thoughts found</p>
                )}
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'flex-start' }}>
                {!hasHumanData ? (
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data available</p>
                ) : humanExpLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>
                    <Spinner size={9} /> Analysing…
                  </div>
                ) : humanExplanation ? (
                  <div style={{ borderLeft: '2px solid #f59e0b', paddingLeft: 7 }}>
                    <RichText text={humanExplanation} style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.55 }} />
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic' }}>No human data available</p>
                )}
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Diagram chips — compact pill links */}
      {diagrams.length > 0 && (
        <CollapsibleSection label="Verify in diagrams">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {diagrams.map((d) => {
              const label = DIAGRAM_LABELS[d.view] ?? d.view
              const derivedSide = point.item.type === 'agent_gap' ? 'ai' : point.item.type === 'human_issue' ? 'human' : undefined
              const enriched: DiagramRef = {
                ...d,
                highlight: { ...d.highlight, side: d.highlight?.side ?? derivedSide },
              }
              return (
                <button
                  key={d.view}
                  title={d.reason}
                  onClick={() => onNavigateTo('views', d.view, { actionPointText: point.item.text, taskTitle: point.task.task_title, evidence: d.reason }, enriched, d.view === 'heatmap' ? point.item.text : undefined)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '5px 10px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'none',
                    fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--brand)',
                    cursor: 'pointer', transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  {label}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
                    <path d="M2.5 6h7M6.5 3l3 3-3 3"/>
                  </svg>
                </button>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 10, borderTop: '1px solid var(--gray100)' }}>
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, marginRight: 4 }}>{idx + 1} / {total}</span>
        <button onClick={onDone} style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 700, cursor: 'pointer',
          border: 'none',
          background: status === 'done' ? '#2563eb22' : 'var(--brand)',
          color: status === 'done' ? 'var(--brand)' : '#fff',
        }}>{status === 'done' ? '✓ Done' : 'Mark done'}</button>
        <button onClick={onSkip} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer',
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: status === 'skipped' ? 'var(--gray400)' : 'var(--gray600)',
        }}>{status === 'skipped' ? 'Restore' : 'Skip'}</button>
        <button
          onClick={onRemove}
          title="Remove this action point"
          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid transparent', background: 'none', color: 'transparent', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#fca5a5'; e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#fff1f2' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'transparent'; e.currentTarget.style.background = 'none' }}
        >✕</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          <button onClick={onPrev} disabled={idx === 0} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: idx === 0 ? 'not-allowed' : 'pointer', border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--gray700)', opacity: idx === 0 ? 0.4 : 1,
          }}>← Prev</button>
          <button onClick={onNext} disabled={idx >= total - 1} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 'var(--fs-body)', fontWeight: 600,
            cursor: idx >= total - 1 ? 'not-allowed' : 'pointer', border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--gray700)', opacity: idx >= total - 1 ? 0.4 : 1,
          }}>Next →</button>
        </div>
      </div>
    </div>
  )
}
