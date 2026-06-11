import { useEffect, useRef, useState } from 'react'
import type { AnnotateResult } from '../../../lib/api'
import * as api from '../../../lib/api'
import { storageKeys, loadJSON, loadMap, saveMap, saveJSON, removeKey } from '../../../lib/storage'
import { debug, debugWarn, debugError } from '../../../lib/debug'

function loadSelections(siteId: string): Map<string, number | null> {
  return new Map(
    Object.entries(loadJSON<Record<string, number | null>>(storageKeys.selections(siteId), {})).map(
      ([k, v]) => [k, v === null ? null : Number(v)]
    )
  )
}

function centerFallback(text: string): AnnotateResult {
  const label = text.slice(0, 80) + (text.length > 80 ? '…' : '')
  return { found: true, points: [{ x: 50, y: 40, label, glyph: 'warning' }], x: 50, y: 40, width: 0.1, height: 0.05 }
}

/**
 * AI screenshot selection + annotation pipeline for action points.
 *
 * Two sequential job queues (1 concurrent request each):
 *   1. selection — pick the most relevant screenshot for a point
 *   2. annotation — place issue dots on the selected screenshot
 *
 * Results are cached in localStorage per site and reset when a new analysis
 * run starts (analysisRunId changes).
 */
export function useAnnotationQueue(siteId: string, analysisRunId?: number) {
  // pointId → screenshotId (null = AI found no matching screenshot)
  const [selections, setSelections] = useState<Map<string, number | null>>(() => loadSelections(siteId))
  // `${pointId}:${screenshotId}` → AnnotateResult
  const [annotations, setAnnotations] = useState<Map<string, AnnotateResult>>(() => loadMap<AnnotateResult>(storageKeys.annotations(siteId)))

  const selectingRef = useRef(new Set<string>())
  const annotatingRef = useRef(new Set<string>())
  const selQueueRef = useRef<Array<{ pointId: string; selText: string; annText: string; shotIds: number[] }>>([])
  const annQueueRef = useRef<Array<{ key: string; shotId: number; text: string }>>([])
  const selActiveRef = useRef(0)
  const annActiveRef = useRef(0)
  // Mirror of `annotations` for cache checks inside queue callbacks (avoids stale closures)
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  // New analysis run → previous selections/annotations are obsolete
  useEffect(() => {
    if (!analysisRunId) return  // 0 = initial mount, don't clear cached data
    setSelections(new Map())
    setAnnotations(new Map())
    selectingRef.current.clear()
    annotatingRef.current.clear()
    selQueueRef.current = []
    annQueueRef.current = []
    selActiveRef.current = 0
    annActiveRef.current = 0
    removeKey(storageKeys.selections(siteId))
    removeKey(storageKeys.annotations(siteId))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisRunId])

  useEffect(() => { saveJSON(storageKeys.selections(siteId), Object.fromEntries(selections)) }, [siteId, selections])
  useEffect(() => { saveMap(storageKeys.annotations(siteId), annotations) }, [siteId, annotations])

  function drainAnnQueue() {
    while (annActiveRef.current < 1 && annQueueRef.current.length > 0) {
      const job = annQueueRef.current.shift()!
      annActiveRef.current++
      debug(`[CC:ann] START ${job.key} | shotId: ${job.shotId} | text: "${job.text.slice(0, 60)}"`)
      api.annotateScreenshot(job.shotId, job.text)
        .then(r => {
          debug(`[CC:ann] API   ${job.key} → found: ${r.found}, points: ${r.points.length}`, r.points.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)}) "${p.label.slice(0, 40)}"`))
          const result = (!r.found || r.points.length === 0) ? centerFallback(job.text) : r
          setAnnotations(m => new Map(m).set(job.key, result))
        })
        .catch((err) => {
          debugError(`[CC:ann] ERROR ${job.key}:`, err)
          setAnnotations(m => new Map(m).set(job.key, centerFallback(job.text)))
        })
        .finally(() => {
          annotatingRef.current.delete(job.key)
          annActiveRef.current--
          drainAnnQueue()
        })
    }
  }

  function enqueueAnnotation(pointId: string, shotId: number, text: string, prepend: boolean) {
    const key = `${pointId}:${shotId}`
    if (annotationsRef.current.has(key)) {
      debug(`[CC:ann] SKIP  ${key} (already in cache)`)
      return
    }
    if (annotatingRef.current.has(key)) {
      debug(`[CC:ann] SKIP  ${key} (already in-flight)`)
      return
    }
    debug(`[CC:ann] QUEUE ${key} | prepend: ${prepend}`)
    annotatingRef.current.add(key)
    if (prepend) annQueueRef.current.unshift({ key, shotId, text })
    else annQueueRef.current.push({ key, shotId, text })
    drainAnnQueue()
  }

  function drainSelQueue() {
    while (selActiveRef.current < 1 && selQueueRef.current.length > 0) {
      const job = selQueueRef.current.shift()!
      selActiveRef.current++
      debug(`[CC:sel] START ${job.pointId} | candidates: ${job.shotIds.length} shots | text: "${job.selText.slice(0, 60)}"`)
      api.selectScreenshot(job.shotIds, job.selText)
        .then(r => {
          const shotId = r.screenshot_id  // null = model found no matching screenshot
          debug(`[CC:sel] DONE  ${job.pointId} → shotId: ${shotId}`)
          setSelections(m => new Map(m).set(job.pointId, shotId))
          if (shotId !== null) enqueueAnnotation(job.pointId, shotId, job.annText, false)
          else debugWarn(`[CC:sel] NO MATCH for ${job.pointId} — no annotation will run`)
        })
        .catch((err) => {
          // Network/API failure — fall back to first candidate so we still show something
          const shotId = job.shotIds[0]
          debugWarn(`[CC:sel] ERROR ${job.pointId}:`, err, `→ fallback shotId: ${shotId}`)
          setSelections(m => new Map(m).set(job.pointId, shotId))
          enqueueAnnotation(job.pointId, shotId, job.annText, false)
        })
        .finally(() => {
          selectingRef.current.delete(job.pointId)
          selActiveRef.current--
          drainSelQueue()
        })
    }
  }

  /** Queue screenshot selection for a point unless cached or in-flight. */
  function enqueueSelection(pointId: string, selText: string, annText: string, shotIds: number[], prepend: boolean) {
    if (selectingRef.current.has(pointId)) return
    selectingRef.current.add(pointId)
    const job = { pointId, selText, annText, shotIds }
    if (prepend) selQueueRef.current.unshift(job)
    else selQueueRef.current.push(job)
    drainSelQueue()
  }

  /** Drop cached selection/annotations for a removed point so a future point
   *  with the same deterministic id can't inherit stale results. */
  function removePointCache(pointId: string) {
    setSelections(m => {
      if (!m.has(pointId)) return m
      const n = new Map(m)
      n.delete(pointId)
      return n
    })
    setAnnotations(m => {
      const stale = [...m.keys()].filter(k => k.startsWith(`${pointId}:`))
      if (stale.length === 0) return m
      const n = new Map(m)
      for (const k of stale) n.delete(k)
      return n
    })
  }

  return { selections, annotations, enqueueSelection, enqueueAnnotation, removePointCache }
}
