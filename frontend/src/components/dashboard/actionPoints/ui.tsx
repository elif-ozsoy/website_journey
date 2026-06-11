import React, { useState } from 'react'

export function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 4px', fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{children}</p>
}

export function CollapsibleSection({ label, children, defaultOpen = true }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, width: '100%',
          background: 'none', border: 'none', padding: '0 0 4px', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          stroke="var(--gray400)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <path d="M2 3.5l3 3 3-3"/>
        </svg>
      </button>
      {open && children}
    </div>
  )
}

/** Render text with **bold** markdown as actual bold spans, split into paragraphs on blank lines. */
export function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  return (
    <>
      {paragraphs.map((para, pi) => {
        const parts = para.split(/\*\*/)
        return (
          <p key={pi} style={{ margin: pi > 0 ? '6px 0 0' : 0, ...style }}>
            {parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}
          </p>
        )
      })}
    </>
  )
}

export function Spinner({ size = 10 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', flexShrink: 0, border: `${Math.max(1.5, size / 6)}px solid var(--gray200)`, borderTopColor: 'var(--brand)', animation: 'spin 0.7s linear infinite' }} />
}
