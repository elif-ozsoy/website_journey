import { useEffect, useRef, useState } from 'react'
import type { PointStatus } from '../../../lib/actionPoints'
import { storageKeys, loadJSON, saveJSON, loadMap, saveMap, loadSet, saveSet } from '../../../lib/storage'

/**
 * User-editable per-site action-point state (statuses, removed points,
 * edited issue/recommendation texts), persisted to localStorage.
 *
 * Site switches are handled explicitly: while `siteId` differs from the site
 * the current state belongs to, persistence is suspended so the previous
 * site's data can never be written under the new site's keys.
 */
export function useActionPointState(siteId: string) {
  const [statuses, setStatuses] = useState<Record<string, PointStatus>>(() => loadJSON(storageKeys.pointStatuses(siteId), {}))
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => loadSet(storageKeys.removedPoints(siteId)))
  const [editedTexts, setEditedTexts] = useState<Map<string, string>>(() => loadMap<string>(storageKeys.editedTexts(siteId)))
  const [editedRecs, setEditedRecs] = useState<Map<string, string>>(() => loadMap<string>(storageKeys.editedRecs(siteId)))

  // The site the current state belongs to. Persistence effects bail out while
  // this lags behind the siteId prop (i.e. during a site switch).
  const stateSiteRef = useRef(siteId)

  useEffect(() => {
    if (stateSiteRef.current !== siteId) return
    saveJSON(storageKeys.pointStatuses(siteId), statuses)
  }, [siteId, statuses])
  useEffect(() => {
    if (stateSiteRef.current !== siteId) return
    saveSet(storageKeys.removedPoints(siteId), removedIds)
  }, [siteId, removedIds])
  useEffect(() => {
    if (stateSiteRef.current !== siteId) return
    saveMap(storageKeys.editedTexts(siteId), editedTexts)
  }, [siteId, editedTexts])
  useEffect(() => {
    if (stateSiteRef.current !== siteId) return
    saveMap(storageKeys.editedRecs(siteId), editedRecs)
  }, [siteId, editedRecs])

  // Reload state for the new site. Declared after the persistence effects so
  // they observe the stale ref (and skip) before it is updated here.
  useEffect(() => {
    if (stateSiteRef.current === siteId) return
    setStatuses(loadJSON(storageKeys.pointStatuses(siteId), {}))
    setRemovedIds(loadSet(storageKeys.removedPoints(siteId)))
    setEditedTexts(loadMap<string>(storageKeys.editedTexts(siteId)))
    setEditedRecs(loadMap<string>(storageKeys.editedRecs(siteId)))
    stateSiteRef.current = siteId
  }, [siteId])

  function setStatus(id: string, s: PointStatus) {
    setStatuses(prev => ({ ...prev, [id]: s }))
  }
  function removePointId(id: string) {
    setRemovedIds(prev => new Set([...prev, id]))
  }
  function editText(id: string, text: string) {
    setEditedTexts(prev => new Map(prev).set(id, text))
  }
  function editRec(id: string, text: string) {
    setEditedRecs(prev => new Map(prev).set(id, text))
  }

  return { statuses, setStatus, removedIds, removePointId, editedTexts, editText, editedRecs, editRec }
}
