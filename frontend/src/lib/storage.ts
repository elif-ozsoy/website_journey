/**
 * Central registry for every localStorage key plus safe JSON load/save helpers.
 *
 * All persistence goes through this module so that:
 *  - key strings exist exactly once (no drifting copies across components)
 *  - every read tolerates corrupt/missing JSON (returns the fallback)
 *  - every write tolerates QuotaExceededError (private browsing, full storage)
 */

export const storageKeys = {
  // Auth / API keys
  token: 'ciphercorgi_token',
  user: 'ciphercorgi_user',
  agentApiKey: 'ciphercorgi_apikey',
  agentApiKeyGoogle: 'ciphercorgi_apikey_google',
  agentProvider: 'ciphercorgi_provider',
  anthropicKey: 'cc_api_key_anthropic',
  providerApiKey: (provider: string) => `cc_api_key_${provider}`,

  // Projects / versions
  projects: 'ciphercorgi_projects',
  versions: (siteId: string) => `ciphercorgi_versions_${siteId}`,
  lastVersion: (siteId: string) => `ciphercorgi_last_version_${siteId}`,

  // Analysis / agent runs (per site)
  analysis: (siteId: string, versionId: string) => `ciphercorgi_comparative_${siteId}_${versionId}`,
  agentRun: (siteId: string, versionId?: string) =>
    versionId ? `ciphercorgi_agent_run_${siteId}_${versionId}` : `ciphercorgi_agent_run_${siteId}`,
  prevPolicyFlag: (siteId: string) => `cc_run_prev_policy_${siteId}`,

  // Action points (per site)
  pointStatuses: (siteId: string) => `ciphercorgi_action_points_${siteId}`,
  annotations: (siteId: string) => `ciphercorgi_annotations_v9_${siteId}`,
  selections: (siteId: string) => `ciphercorgi_selections_v3_${siteId}`,
  removedPoints: (siteId: string) => `ciphercorgi_removed_points_${siteId}`,
  editedTexts: (siteId: string) => `ciphercorgi_edited_texts_${siteId}`,
  editedRecs: (siteId: string) => `ciphercorgi_edited_recs_${siteId}`,
} as const

/** Parse JSON from localStorage; return `fallback` when missing or corrupt. */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Stringify and store; silently ignores quota/serialisation errors. */
export function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode */ }
}

export function removeKey(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

/** Load an object persisted via saveMap back into a Map. */
export function loadMap<V>(key: string): Map<string, V> {
  return new Map(Object.entries(loadJSON<Record<string, V>>(key, {})))
}

export function saveMap<V>(key: string, m: Map<string, V>): void {
  saveJSON(key, Object.fromEntries(m))
}

/** Load an array persisted via saveSet back into a Set. */
export function loadSet(key: string): Set<string> {
  return new Set(loadJSON<string[]>(key, []))
}

export function saveSet(key: string, s: Set<string>): void {
  saveJSON(key, [...s])
}
