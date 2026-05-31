/* ────────────────────────────────────────────────────────────────────────────
 *  Shared horizon-density helpers
 *
 *  These were originally private to HorizonGraph.tsx. They are extracted here so
 *  the linked Flow + Horizon view (LinkedHorizonStrip) can build the exact same
 *  per-journey activity-density curve that the standalone Horizon Graph uses,
 *  keeping the two views visually consistent.
 * ────────────────────────────────────────────────────────────────────────── */

import type { AgentStep } from '../agent/agentTypes'

/* Number of samples in a density curve. */
export const SAMPLE_COUNT = 240
/* Gaussian KDE bandwidth (in relative-time units, 0..1). */
export const KDE_BANDWIDTH = 0.05

export interface JourneySample {
  relT: number
  step: AgentStep
  stepIdx: number
}

/* A step "counts" as activity unless it is a no-op / wait / content read. */
export function isCountableAction(s: AgentStep): boolean {
  const a = (s.action_type ?? '').toLowerCase()
  return !(!a || a === 'unknown' || a === 'wait' || a === 'extract_content')
}

/* Map a journey's countable steps onto a 0..1 relative-time axis. Uses real
 * timestamps when available, otherwise falls back to even step spacing. */
export function buildJourneySamples(steps: AgentStep[]): JourneySample[] {
  if (steps.length === 0) return []
  const tsSteps = steps.filter(s => typeof (s as any).timestamp === 'number')
  let useTs = false, t0 = 0, t1 = 0
  if (tsSteps.length >= 2) {
    t0 = (tsSteps[0] as any).timestamp
    t1 = (tsSteps[tsSteps.length - 1] as any).timestamp
    if (t1 > t0) useTs = true
  }
  const out: JourneySample[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isCountableAction(s)) continue
    let relT = steps.length > 1 ? i / (steps.length - 1) : 0
    if (useTs && typeof (s as any).timestamp === 'number') {
      relT = ((s as any).timestamp - t0) / (t1 - t0)
    }
    out.push({ relT: Math.max(0, Math.min(1, relT)), step: s, stepIdx: i })
  }
  return out
}

/* Gaussian kernel density estimate of the samples over `n` evenly-spaced
 * points across the 0..1 time axis. */
export function gaussianKDE(samples: JourneySample[], bw: number, n: number): number[] {
  const out = new Array(n).fill(0) as number[]
  if (samples.length === 0) return out
  const inv2 = 1 / (2 * bw * bw)
  const norm = 1 / (bw * Math.sqrt(2 * Math.PI))
  for (let g = 0; g < n; g++) {
    const t = g / (n - 1)
    let s = 0
    for (const p of samples) { const d = t - p.relT; s += norm * Math.exp(-d * d * inv2) }
    out[g] = s
  }
  return out
}

/* Convenience: density curve for a single journey's steps. */
export function densityForSteps(steps: AgentStep[]): number[] {
  return gaussianKDE(buildJourneySamples(steps), KDE_BANDWIDTH, SAMPLE_COUNT)
}
