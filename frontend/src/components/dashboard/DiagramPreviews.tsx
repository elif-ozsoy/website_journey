export function HeatmapPreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="42" rx="3" fill="#0f172a" stroke="#1e293b"/>
      <rect x="8" y="8" width="64" height="10" rx="2" fill="#1e293b"/>
      <rect x="10" y="10" width="18" height="6" rx="1" fill="#334155"/>
      <ellipse cx="38" cy="28" rx="12" ry="8" fill="#ef4444" fillOpacity="0.5"/>
      <ellipse cx="38" cy="28" rx="6" ry="4" fill="#ef4444" fillOpacity="0.7"/>
      <ellipse cx="38" cy="28" rx="2.5" ry="1.8" fill="#ef4444"/>
      <ellipse cx="58" cy="32" rx="7" ry="5" fill="#f97316" fillOpacity="0.35"/>
      <ellipse cx="18" cy="34" rx="5" ry="3.5" fill="#eab308" fillOpacity="0.3"/>
    </svg>
  )
}

export function FlowMapPreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arr" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="#334155"/>
        </marker>
      </defs>
      {([8, 22, 36, 50, 64] as const).map((x, i) => (
        <g key={i}>
          <rect x={x} y="18" width="12" height="14" rx="3"
            fill={i === 2 ? '#2563eb' : '#1e293b'}
            stroke={i === 2 ? '#2563eb' : '#334155'}/>
          {i < 4 && <line x1={x + 12} y1="25" x2={x + 16} y2="25" stroke="#334155" strokeWidth="1.5" markerEnd="url(#arr)"/>}
        </g>
      ))}
    </svg>
  )
}

export function SankeyPreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="18" width="10" height="14" rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="34" y="10" width="10" height="8" rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="34" y="22" width="10" height="6" rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="34" y="32" width="10" height="5" rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="64" y="14" width="10" height="10" rx="2" fill="#2563eb" stroke="#2563eb" fillOpacity="0.7"/>
      <rect x="64" y="28" width="10" height="8" rx="2" fill="#1e293b" stroke="#334155"/>
      <path d="M14 22 C24 22 24 14 34 14" stroke="#2563eb" strokeWidth="4" strokeOpacity="0.5" fill="none"/>
      <path d="M14 26 C24 26 24 25 34 25" stroke="#2563eb" strokeWidth="2.5" strokeOpacity="0.4" fill="none"/>
      <path d="M14 29 C24 29 24 34.5 34 34.5" stroke="#475569" strokeWidth="1.5" strokeOpacity="0.5" fill="none"/>
      <path d="M44 14 C54 14 54 19 64 19" stroke="#2563eb" strokeWidth="3.5" strokeOpacity="0.5" fill="none"/>
      <path d="M44 25 C54 25 54 32 64 32" stroke="#475569" strokeWidth="2" strokeOpacity="0.4" fill="none"/>
    </svg>
  )
}

export function ComparePreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="34" height="42" rx="3" fill="#0f172a" stroke="#1e293b"/>
      <rect x="42" y="4" width="34" height="42" rx="3" fill="#0f172a" stroke="#1e293b"/>
      <text x="21" y="13" textAnchor="middle" fontSize="5" fill="#32494B" fontWeight="700">AI</text>
      <text x="59" y="13" textAnchor="middle" fontSize="5" fill="#881342" fontWeight="700">Human</text>
      <rect x="8" y="18" width="22" height="4" rx="1" fill="#334155"/>
      <rect x="8" y="24" width="14" height="4" rx="1" fill="#334155"/>
      <rect x="8" y="30" width="18" height="4" rx="1" fill="#334155"/>
      <rect x="8" y="36" width="10" height="4" rx="1" fill="#32494B" fillOpacity="0.5"/>
      <rect x="46" y="18" width="16" height="4" rx="1" fill="#334155"/>
      <rect x="46" y="24" width="22" height="4" rx="1" fill="#334155"/>
      <rect x="46" y="30" width="12" height="4" rx="1" fill="#334155"/>
      <rect x="46" y="36" width="20" height="4" rx="1" fill="#881342" fillOpacity="0.5"/>
    </svg>
  )
}

export function InsightsPreview() {
  const items = [
    { x: 6, y: 10, val: '24', label: 'Sessions' },
    { x: 42, y: 10, val: '8.3', label: 'Avg steps' },
    { x: 6, y: 30, val: '62%', label: 'Drop-off' },
    { x: 42, y: 30, val: '4.1s', label: 'Avg time' },
  ]
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      {items.map(({ x, y, val, label }) => (
        <g key={label}>
          <rect x={x} y={y} width="32" height="16" rx="3" fill="#0f172a" stroke="#1e293b"/>
          <text x={x + 16} y={y + 8} textAnchor="middle" fontSize="7" fill="#2563eb" fontWeight="800">{val}</text>
          <text x={x + 16} y={y + 13} textAnchor="middle" fontSize="4" fill="#475569">{label}</text>
        </g>
      ))}
    </svg>
  )
}

export function MultiFlowPreview() {
  const lanes = [0, 1, 2, 3, 4]
  const nodes = [0, 1, 2, 3, 4]
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      {lanes.map(li => (
        <g key={li}>
          {nodes.map(ni => (
            <g key={ni}>
              <circle
                cx={4 + ni * 14 + 5} cy={8 + li * 8 + 4} r="3.5"
                fill={li === 2 && ni === 3 ? '#ef4444' : '#1e293b'}
                stroke={li < 2 ? '#32494B' : '#881342'}
                strokeWidth="1"
              />
              {ni < 4 && (
                <line
                  x1={4 + ni * 14 + 8.5} y1={8 + li * 8 + 4}
                  x2={4 + ni * 14 + 18} y2={8 + li * 8 + 4}
                  stroke={li < 2 ? '#32494B55' : '#88134255'}
                  strokeWidth="1"
                />
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  )
}

export function SimilarityPreview() {
  const vals = [[0.9, 0.7, 0.4, 0.6], [0.5, 0.85, 0.3, 0.7], [0.3, 0.5, 0.75, 0.45]]
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="6" width="58" height="38" rx="2" fill="#0f172a" stroke="#1e293b"/>
      {vals.map((row, ri) => row.map((val, ci) => (
        <rect key={`${ri}-${ci}`}
          x={19 + ci * 13} y={10 + ri * 11} width="11" height="9" rx="1.5"
          fill={`rgba(37,99,235,${val})`}
        />
      )))}
      {['A1', 'A2', 'A3'].map((l, i) => <text key={l} x="4" y={16 + i * 11} fontSize="4" fill="#475569">{l}</text>)}
      {['H1', 'H2', 'H3', 'H4'].map((l, i) => <text key={l} x={22 + i * 13} y="9" fontSize="4" fill="#475569">{l}</text>)}
    </svg>
  )
}

export function ComparativePreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="72" height="42" rx="3" fill="#0f172a" stroke="#1e293b"/>
      <rect x="8" y="8" width="40" height="4" rx="1" fill="#334155"/>
      <rect x="8" y="15" width="64" height="2.5" rx="1" fill="#1e293b"/>
      <rect x="8" y="19" width="58" height="2.5" rx="1" fill="#1e293b"/>
      <rect x="8" y="23" width="48" height="2.5" rx="1" fill="#1e293b"/>
      <rect x="8" y="30" width="28" height="3.5" rx="1" fill="#2563eb" fillOpacity="0.4"/>
      <rect x="8" y="36" width="64" height="2" rx="1" fill="#1e293b"/>
      <rect x="8" y="40" width="52" height="2" rx="1" fill="#1e293b"/>
      <circle cx="70" cy="10" r="5" fill="#2563eb" fillOpacity="0.2" stroke="#2563eb" strokeWidth="1"/>
      <text x="70" y="12" textAnchor="middle" fontSize="5" fill="#2563eb">AI</text>
    </svg>
  )
}

export function HumanAggregatePreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* source node */}
      <rect x="4" y="20" width="10" height="10" rx="2" fill="#1e293b" stroke="#334155"/>
      {/* mid nodes */}
      <rect x="30" y="8"  width="10" height="7"  rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="30" y="20" width="10" height="5"  rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="30" y="30" width="10" height="4"  rx="2" fill="#1e293b" stroke="#334155"/>
      {/* dest nodes */}
      <rect x="58" y="10" width="10" height="8" rx="2" fill="#1e293b" stroke="#334155"/>
      <rect x="58" y="26" width="10" height="6" rx="2" fill="#1e293b" stroke="#334155"/>
      {/* thick green path (≥50%) */}
      <path d="M14 23 C22 23 22 11 30 11" stroke="#16a34a" strokeWidth="4" strokeOpacity="0.55" fill="none"/>
      {/* medium amber path */}
      <path d="M14 25 C22 25 22 22 30 22" stroke="#d97706" strokeWidth="2.5" strokeOpacity="0.5" fill="none"/>
      {/* thin red path (<20%) */}
      <path d="M14 27 C22 27 22 31 30 31" stroke="#dc2626" strokeWidth="1.5" strokeOpacity="0.45" fill="none"/>
      {/* dest links */}
      <path d="M40 11 C49 11 49 14 58 14" stroke="#16a34a" strokeWidth="3.5" strokeOpacity="0.5" fill="none"/>
      <path d="M40 22 C49 22 49 28 58 28" stroke="#d97706" strokeWidth="2" strokeOpacity="0.4" fill="none"/>
      {/* legend dots */}
      <circle cx="6"  cy="44" r="2" fill="#16a34a"/>
      <circle cx="20" cy="44" r="2" fill="#d97706"/>
      <circle cx="34" cy="44" r="2" fill="#dc2626"/>
      <text x="9"  y="46" fontSize="3.5" fill="#475569">≥50%</text>
      <text x="23" y="46" fontSize="3.5" fill="#475569">20–49%</text>
      <text x="37" y="46" fontSize="3.5" fill="#475569">&lt;20%</text>
    </svg>
  )
}

export function PolicyBotPreview() {
  return (
    <svg viewBox="0 0 80 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* step nodes */}
      {[8, 22, 36, 50, 64].map((x, i) => (
        <g key={i}>
          <rect x={x} y="16" width="10" height="10" rx="2"
            fill={i === 2 ? '#2563eb22' : '#1e293b'}
            stroke={i === 2 ? '#2563eb' : '#334155'}
            strokeWidth={i === 2 ? 1.5 : 1}/>
          {i < 4 && <line x1={x+10} y1="21" x2={x+14} y2="21" stroke="#334155" strokeWidth="1"/>}
        </g>
      ))}
      {/* human policy badge on node 2 */}
      <rect x="31" y="9" width="20" height="5" rx="1.5" fill="#881342" fillOpacity="0.25" stroke="#881342" strokeWidth="0.8"/>
      <text x="41" y="13" textAnchor="middle" fontSize="3.5" fill="#881342" fontWeight="700">policy</text>
      <line x1="41" y1="14" x2="36" y2="16" stroke="#881342" strokeWidth="0.8" strokeOpacity="0.6"/>
      {/* thought bubble on node 2 */}
      <rect x="28" y="29" width="24" height="9" rx="2" fill="#1e293b" stroke="#334155"/>
      <text x="40" y="35" textAnchor="middle" fontSize="3.2" fill="#94a3b8">follows human</text>
      <line x1="40" y1="29" x2="38" y2="26" stroke="#334155" strokeWidth="0.8"/>
      {/* AI label */}
      <text x="6" y="45" fontSize="3.8" fill="#32494B" fontWeight="700">AI</text>
      <text x="13" y="45" fontSize="3.8" fill="#475569">guided by</text>
      <text x="34" y="45" fontSize="3.8" fill="#881342" fontWeight="700">human policy</text>
    </svg>
  )
}
