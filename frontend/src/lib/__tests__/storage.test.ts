import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadJSON, saveJSON, loadMap, saveMap, loadSet, saveSet, storageKeys } from '../storage'

// Minimal localStorage stub for the node test environment
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})

describe('loadJSON / saveJSON', () => {
  it('round-trips a value', () => {
    saveJSON('k', { a: 1 })
    expect(loadJSON('k', {})).toEqual({ a: 1 })
  })

  it('returns fallback for missing key', () => {
    expect(loadJSON('missing', 'fb')).toBe('fb')
  })

  it('returns fallback for corrupt JSON', () => {
    store.set('bad', '{not json')
    expect(loadJSON('bad', 42)).toBe(42)
  })

  it('swallows write errors (quota exceeded)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('quota') },
      removeItem: () => {},
    })
    expect(() => saveJSON('k', 'v')).not.toThrow()
  })
})

describe('map/set round-trips', () => {
  it('saveMap/loadMap', () => {
    saveMap('m', new Map([['a', 1], ['b', 2]]))
    expect(loadMap<number>('m')).toEqual(new Map([['a', 1], ['b', 2]]))
  })

  it('saveSet/loadSet', () => {
    saveSet('s', new Set(['x', 'y']))
    expect(loadSet('s')).toEqual(new Set(['x', 'y']))
  })

  it('empty fallbacks', () => {
    expect(loadMap('nope')).toEqual(new Map())
    expect(loadSet('nope')).toEqual(new Set())
  })
})

describe('storageKeys', () => {
  it('keeps legacy key formats (cached user data must survive)', () => {
    expect(storageKeys.analysis('s1', 'v1')).toBe('ciphercorgi_comparative_s1_v1')
    expect(storageKeys.agentRun('s1')).toBe('ciphercorgi_agent_run_s1')
    expect(storageKeys.agentRun('s1', 'v2')).toBe('ciphercorgi_agent_run_s1_v2')
    expect(storageKeys.annotations('s1')).toBe('ciphercorgi_annotations_v9_s1')
    expect(storageKeys.selections('s1')).toBe('ciphercorgi_selections_v3_s1')
    expect(storageKeys.token).toBe('ciphercorgi_token')
  })
})
