// ─── Main backend types ─────────────────────────────────────────────────────

export interface Project {
  siteId: string
  label: string
  url: string
  testerLink: string
  createdAt: string
  websiteType?: string
  goals?: string
}

export type FocusArea = 'speed' | 'confidence' | 'confusion' | 'accessibility' | 'discoverability' | 'errors'

export const FOCUS_AREA_LABELS: Record<FocusArea, string> = {
  speed: 'Speed',
  confidence: 'Confidence',
  confusion: 'Confusion',
  accessibility: 'Accessibility',
  discoverability: 'Discoverability',
  errors: 'Errors',
}

export interface Task {
  id: number
  siteId: string
  title: string
  description: string | null
  orderIndex: number
  createdAt: string
  focusAreas?: FocusArea[]      // persisted to backend — no longer ephemeral
  expectedSolution?: string
}

export interface Session {
  id: string
  siteId: string
  startedAt: string
  userAgent: string | null
  viewportW: number | null
  viewportH: number | null
  referrer: string | null
  deviceType: string | null
}

export interface EventRow {
  id: number
  sessionId: string
  siteId: string
  type: string
  timestamp: number
  path: string | null
  data: string | null
  createdAt: string
}

// ─── Frontend-only agent type (no backend endpoint yet) ─────────────────────

export interface Agent {
  id: string
  name: string
  model: string
  selected: boolean
  prompt: string
  description?: string
}

export const DEFAULT_AGENTS: Agent[] = [
  { id: 'navigator', name: 'Navigator', model: '', selected: false, prompt: 'Calm and direct. Follows the clearest path.' },
  { id: 'skeptic', name: 'Skeptic', model: '', selected: false, prompt: 'Careful and exact. Looks for unclear labels.' },
  { id: 'first-time-user', name: 'First-time User', model: '', selected: false, prompt: 'Simple and cautious. Explores like a new visitor.' },
]

export interface ModelOption {
  value: string
  label: string
  provider: 'nvidia' | 'google'
}

export const MODEL_OPTIONS: ModelOption[] = [
  // NVIDIA NIM — use your nvapi- key
  { value: 'meta/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B  (NVIDIA NIM)', provider: 'nvidia' },
  { value: 'google/gemma-4-31b-it',                   label: 'Gemma 4 31B  (NVIDIA NIM)',          provider: 'nvidia' },
  // Google Gemini — use your AIza- key
  { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash  (Google)', provider: 'google' },
  { value: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash  (Google)', provider: 'google' },
  { value: 'gemini-1.5-pro',       label: 'Gemini 1.5 Pro  (Google)',   provider: 'google' },
]

export const AVAILABLE_MODELS = MODEL_OPTIONS.map(m => m.value)

export function providerForModel(model: string): 'nvidia' | 'google' | 'local' {
  return MODEL_OPTIONS.find(m => m.value === model)?.provider ?? 'nvidia'
}

// ─── localStorage key ────────────────────────────────────────────────────────

export const PROJECTS_STORAGE_KEY = 'ciphercorgi_projects'