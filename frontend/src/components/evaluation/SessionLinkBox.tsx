import { useState } from 'react'

interface Props {
  testerLink: string
}

export default function SessionLinkBox({ testerLink }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(testerLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const display = testerLink.replace(/^https?:\/\//, '')

  return (
    <div className="session-strip">
      <div className="session-strip-left">
        <span className="session-strip-label">Tester link</span>
        <span className="session-strip-url" title={testerLink}>{display}</span>
      </div>
      <div className="session-strip-actions">
        <button className="btn btn-outline btn-sm" onClick={handleCopy}>
          {copied ? '✓ Copied' : '⎘ Copy link'}
        </button>
        <a className="btn btn-secondary btn-sm" href={testerLink} target="_blank" rel="noopener noreferrer">
          Open ↗
        </a>
      </div>
    </div>
  )
}
