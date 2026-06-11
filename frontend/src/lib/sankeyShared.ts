/**
 * Shared helpers for the two Sankey implementations
 * (components/agent/SankeyDiagram.tsx — page-transition diagram, and
 *  components/dashboard/SankeyDiagram.tsx — milestone diagram).
 *
 * URL normalisation in particular must stay identical between the two,
 * otherwise the diagrams disagree about which steps belong to the same page.
 */

export const AGENT_COLOR = '#0072B2'
export const HUMAN_COLOR = '#E69F00'
export const SANKEY_MARGIN = { top: 28, right: 200, bottom: 20, left: 20 }

/** Normalise a URL to a path key, keeping the page_id query param (SPA pages). */
export function pagePath(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '') || '/'
    const pageId = u.searchParams.get('page_id')
    return path + (pageId ? `?pid=${pageId}` : '')
  } catch {
    return url.slice(0, 36)
  }
}

/** pagePath truncated from the front to 36 chars for axis labels. */
export function pageLabel(url: string): string {
  const full = pagePath(url)
  return full.length > 36 ? '…' + full.slice(-34) : full
}

export function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
