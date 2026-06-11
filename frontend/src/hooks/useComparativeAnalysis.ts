import { useState, useEffect, useRef } from 'react'
import * as api from '../lib/api'
import { storageKeys } from '../lib/storage'

/**
 * Lifecycle of the comparative analysis for one site+version:
 *
 *  - hydrates from the localStorage cache (invalidating it when new journeys
 *    arrived since it was written), falling back to the server copy
 *  - auto-runs the analysis once per version when there is data but no cache
 *  - exposes run/rerun handlers for the UI
 *
 * `analysisRunId` increments on every fresh run — consumers use it to drop
 * derived caches (screenshot selections, annotations).
 */
export function useComparativeAnalysis(
  siteId: string,
  activeVersionId: string,
  agentJourneyCount: number,
  humanJourneyCount: number,
) {
  const [compareAnalysis, setCompareAnalysis] = useState<api.ComparativeAnalysis | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [analysisRunId, setAnalysisRunId] = useState(0)

  // Track latest counts via refs so the async handler always stores the current value,
  // not the stale closure from the render that kicked off the analysis.
  const agentJourneyCountRef = useRef(agentJourneyCount)
  const humanJourneyCountRef = useRef(humanJourneyCount)
  agentJourneyCountRef.current = agentJourneyCount
  humanJourneyCountRef.current = humanJourneyCount
  const compareAnalysisRef = useRef(compareAnalysis)
  compareAnalysisRef.current = compareAnalysis
  const autoRunVersionRef = useRef<string | null>(null)

  useEffect(() => {
    setCompareError(null)
    try {
      const raw = localStorage.getItem(storageKeys.analysis(siteId, activeVersionId))
      if (raw) {
        const parsed = JSON.parse(raw)
        const cachedAgent: number = parsed._agentCount ?? parsed._journeyCount ?? 0
        const cachedUser: number = parsed._userCount ?? 0
        const hasNew = (agentJourneyCount > 0 || humanJourneyCount > 0) &&
          (agentJourneyCount > cachedAgent || humanJourneyCount > cachedUser)
        if (hasNew) {
          localStorage.removeItem(storageKeys.analysis(siteId, activeVersionId))
          autoRunVersionRef.current = null  // reset so the auto-run effect fires
          setCompareAnalysis(null)
          return
        }
        const { _agentCount: _a, _userCount: _u, _journeyCount: _j, ...analysis } = parsed
        setCompareAnalysis(analysis as api.ComparativeAnalysis)
        return
      }
    } catch { /* ignore */ }
    // Only blank out the panel if we have nothing to show yet (first load).
    // If analysis is already visible, leave it in place until the fetch returns.
    if (!compareAnalysisRef.current) setCompareAnalysis(null)
    api.getStoredAnalysis(siteId, activeVersionId)
      .then(result => {
        localStorage.setItem(storageKeys.analysis(siteId, activeVersionId), JSON.stringify({ _agentCount: agentJourneyCountRef.current, _userCount: humanJourneyCountRef.current, ...result }))
        setCompareAnalysis(result)
      })
      .catch(() => {})
  }, [activeVersionId, siteId, agentJourneyCount, humanJourneyCount])

  async function runComparative() {
    if (compareLoading) return
    setCompareLoading(true)
    setCompareError(null)
    try {
      const result = await api.runComparativeAnalysis(siteId, undefined, activeVersionId)
      setAnalysisRunId(id => id + 1)
      setCompareAnalysis(result)
      localStorage.setItem(storageKeys.analysis(siteId, activeVersionId), JSON.stringify({ _agentCount: agentJourneyCountRef.current, _userCount: humanJourneyCountRef.current, ...result }))
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setCompareLoading(false)
    }
  }

  function rerunComparative() {
    setCompareAnalysis(null)
    localStorage.removeItem(storageKeys.analysis(siteId, activeVersionId))
    runComparative()
  }

  // Auto-run once per version when journeys exist but no analysis is cached
  useEffect(() => {
    if (autoRunVersionRef.current === activeVersionId) return
    if (compareLoading || compareAnalysis) return
    if (agentJourneyCount === 0 && humanJourneyCount === 0) return
    const cached = localStorage.getItem(storageKeys.analysis(siteId, activeVersionId))
    if (cached) return
    autoRunVersionRef.current = activeVersionId
    runComparative()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersionId, compareLoading, compareAnalysis, agentJourneyCount, humanJourneyCount])

  return { compareAnalysis, compareLoading, compareError, analysisRunId, runComparative, rerunComparative }
}
