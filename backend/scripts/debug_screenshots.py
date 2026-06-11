#!/usr/bin/env python3
"""
Visualise all screenshots for an agent journey and simulate preselection.

Usage:
  python3 backend/scripts/debug_screenshots.py                     # prompts for journey ID
  python3 backend/scripts/debug_screenshots.py 42                  # journey 42
  python3 backend/scripts/debug_screenshots.py 42 --issue "Users can't find the search bar"

Opens a self-contained HTML gallery in the browser showing:
  - Every screenshot (thumbnail + metadata)
  - Green border  → would survive path-dedup AND heuristic/MMR preselection (sent to Claude)
  - Orange border → survived path-dedup but cut by TOP_K ranking
  - Purple border → survived path-dedup (issue not given, can't rank further)
  - Grey border   → removed by path-dedup
  - Heuristic score shown when --issue is provided

Talks to the backend REST API — no DB credentials needed.
Backend must be running at http://localhost:8082.
"""

from __future__ import annotations

import argparse
import base64
import sys
import tempfile
import webbrowser
from collections import defaultdict
from urllib.error import HTTPError
from urllib.request import urlopen

DEFAULT_BASE = "http://localhost:8082"
TOP_K = 8


# ---------------------------------------------------------------------------
# API helpers (stdlib only)
# ---------------------------------------------------------------------------

def _get(base: str, path: str) -> bytes:
    with urlopen(f"{base}{path}", timeout=10) as r:
        return r.read()


def _get_json(base: str, path: str):
    import json
    return json.loads(_get(base, path))


# ---------------------------------------------------------------------------
# Preselection simulation (mirrors explain.py logic exactly)
# ---------------------------------------------------------------------------

def simulate_dedup(shots: list[dict]) -> set[int]:
    """Return original list indices that survive path-dedup."""
    by_path: dict[str, list[int]] = defaultdict(list)
    for i, s in enumerate(shots):
        by_path[s.get("path") or ""].append(i)

    kept: list[int] = []
    for indices in by_path.values():
        kept.append(indices[0])
        if len(indices) > 1:
            kept.append(indices[-1])
    return set(kept)


def visual_content_score(raw: bytes | None) -> float:
    """Pixel std-dev mapped to [0, 1] — mirrors clip_service._visual_content_score."""
    if not raw:
        return 0.0
    try:
        from PIL import Image, ImageStat
        import io
        img = Image.open(io.BytesIO(raw)).convert("L")
        std = ImageStat.Stat(img).stddev[0]
        return min(std / 45.0, 1.0)
    except Exception:
        return 1.0  # can't compute → don't penalise


def heuristic_score(shot: dict, words: set[str]) -> float:
    _TRIGGER_RANK = {"click": 3, "navigate": 3, "input": 2, "scroll": 1}
    path = (shot.get("path") or "").lower()
    trigger = (shot.get("trigger") or "").lower()
    path_kw = sum(1 for w in words if w in path)
    trigger_score = max(
        (_TRIGGER_RANK.get(t, 0) for t in _TRIGGER_RANK if t in trigger),
        default=0,
    )
    try:
        step = int(shot.get("action_id") or 0)
    except (ValueError, TypeError):
        step = 999
    step_score = max(0, 10 - step) / 10.0
    return path_kw * 3 + trigger_score + step_score


def simulate_preselection(
    shots: list[dict], issue: str
) -> tuple[dict[int, str], dict[int, float]]:
    """
    Returns (categories, scores).

    categories maps list index → one of:
      'preselected'  : would be sent to Claude
      'deduped_cut'  : survived dedup but cut by TOP_K heuristic ranking
      'deduped'      : survived dedup (no issue text to rank further)
      'filtered'     : removed by path-dedup
    scores maps deduped list index → heuristic score (empty if no issue text).
    """
    deduped = simulate_dedup(shots)

    if not issue:
        categories = {
            i: ("deduped" if i in deduped else "filtered")
            for i in range(len(shots))
        }
        return categories, {}

    words = {w for w in issue.lower().split() if len(w) > 3}
    scores = {i: heuristic_score(shots[i], words) for i in deduped}

    if len(deduped) <= TOP_K:
        preselected = deduped
    else:
        ranked = sorted(deduped, key=lambda i: scores[i], reverse=True)
        preselected = set(ranked[:TOP_K])

    categories = {}
    for i in range(len(shots)):
        if i not in deduped:
            categories[i] = "filtered"
        elif i in preselected:
            categories[i] = "preselected"
        else:
            categories[i] = "deduped_cut"

    return categories, scores


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

STYLES = """
body{background:#111827;color:#f9fafb;font-family:monospace;font-size:13px;padding:20px;margin:0}
h1{color:#e5e7eb;margin:0 0 4px}
.subtitle{color:#6b7280;margin-bottom:12px}
.issue-box{background:#1e3a5f;padding:8px 12px;border-radius:6px;margin-bottom:16px;color:#93c5fd}
.legend{display:flex;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.leg{display:flex;align-items:center;gap:6px;font-size:12px}
.dot{width:14px;height:14px;border-radius:3px;flex-shrink:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{background:#1f2937;border-radius:8px;overflow:hidden;padding:10px;box-sizing:border-box}
img{width:100%;border-radius:4px;display:block}
.no-img{background:#374151;height:160px;display:flex;align-items:center;justify-content:center;color:#9ca3af;border-radius:4px}
.meta{padding:6px 0 2px;line-height:1.8}
.meta div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badges{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px}
.b-pre{background:#14532d;color:#86efac}
.b-deduped{background:#312e81;color:#a5b4fc}
.b-cut{background:#451a03;color:#fdba74}
.b-filtered{background:#1f2937;color:#6b7280;border:1px solid #374151}
.score{color:#fcd34d;font-weight:bold}
"""

BORDER = {
    "preselected": "3px solid #22c55e",
    "deduped": "2px solid #6366f1",
    "deduped_cut": "2px solid #f97316",
    "filtered": "1px solid #374151",
}

BADGE = {
    "preselected": ("b-pre", "pre-selected"),
    "deduped": ("b-deduped", "survived dedup"),
    "deduped_cut": ("b-cut", "dedup OK / cut by rank"),
    "filtered": ("b-filtered", "filtered out"),
}


def _detect_mime(raw: bytes) -> str:
    if raw[:4] == b"\x89PNG":
        return "image/png"
    if raw[:2] == b"\xff\xd8":
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def make_card(shot: dict, img_bytes: bytes | None, category: str, score: float | None) -> str:
    sid = shot.get("id", "?")
    path = shot.get("path") or "—"
    trigger = shot.get("trigger") or "—"
    action_id = shot.get("action_id") or "—"
    created = (shot.get("created_at") or "")[:19]

    vis = visual_content_score(img_bytes)
    vis_color = "#22c55e" if vis >= 0.7 else ("#f97316" if vis >= 0.35 else "#ef4444")

    if img_bytes:
        mime = _detect_mime(img_bytes)
        b64 = base64.b64encode(img_bytes).decode()
        img_tag = f'<img src="data:{mime};base64,{b64}" loading="lazy" />'
    else:
        img_tag = '<div class="no-img">no image</div>'

    score_html = f' <span class="score">{score:.2f}</span>' if score is not None else ""
    bcls, blabel = BADGE[category]

    return f"""
<div class="card" style="border:{BORDER[category]}">
  {img_tag}
  <div class="meta">
    <div><b>ID:</b> {sid}</div>
    <div><b>Path:</b> {path}</div>
    <div><b>Trigger:</b> {trigger}</div>
    <div><b>Action:</b> {action_id}</div>
    <div><b>Time:</b> {created}</div>
    <div><b>Visual:</b> <span style="color:{vis_color}">{vis:.2f}</span></div>
  </div>
  <div class="badges">
    <span class="badge {bcls}">{blabel}{score_html}</span>
  </div>
</div>"""


def build_html(
    title: str,
    shots: list[dict],
    raw_images: dict[int, bytes],
    categories: dict[int, str],
    scores: dict[int, float],
    issue: str,
) -> str:
    counts: dict[str, int] = defaultdict(int)
    for c in categories.values():
        counts[c] += 1

    issue_html = f'<div class="issue-box">Issue: <em>"{issue}"</em></div>' if issue else ""

    cards_html = "".join(
        make_card(
            s,
            raw_images.get(s["id"]),
            categories[i],
            scores.get(i) if issue else None,
        )
        for i, s in enumerate(shots)
    )

    legend_items = [
        ("#22c55e", f"pre-selected → sent to Claude ({counts['preselected']})"),
        ("#6366f1", f"survived dedup, not ranked ({counts['deduped']})"),
        ("#f97316", f"survived dedup, cut by rank ({counts['deduped_cut']})"),
        ("#374151", f"removed by path-dedup ({counts['filtered']})"),
    ]
    legend_html = "".join(
        f'<div class="leg"><div class="dot" style="background:{c}"></div>{label}</div>'
        for c, label in legend_items
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Screenshots — {title}</title>
<style>{STYLES}</style>
</head>
<body>
<h1>{title}</h1>
<div class="subtitle">{len(shots)} screenshots total · TOP_K={TOP_K}</div>
{issue_html}
<div class="legend">{legend_html}</div>
<div class="grid">{cards_html}</div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("journey_ids", type=int, nargs="*",
                        help="Agent journey ID(s) — fetches agent screenshots")
    parser.add_argument("--sessions", default="",
                        help="Comma-separated human session IDs to include (e.g. s_abc,s_def)")
    parser.add_argument("--issue", default="",
                        help="Issue/action-point text to simulate heuristic preselection scoring")
    parser.add_argument("--base", default=DEFAULT_BASE,
                        help=f"Backend base URL (default: {DEFAULT_BASE})")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    if not args.journey_ids and not args.sessions:
        print("Provide at least one journey ID or --sessions, e.g.:")
        print(f"  python3 {sys.argv[0]} 39 40")
        print(f"  python3 {sys.argv[0]} 39 40 --sessions s_abc,s_def --issue 'text…'")
        print("\nFind journey IDs and human sessions:")
        print("  docker compose exec postgres psql -U postgres -c \\")
        print("    \"SELECT j.id, j.task_id, COUNT(s.id) shots FROM journeys j \\")
        print("     LEFT JOIN screenshots s ON s.session_id='browseruse:'||j.id::text \\")
        print("     GROUP BY j.id ORDER BY j.id DESC LIMIT 10;\"")
        sys.exit(1)

    shots: list[dict] = []

    # Agent journey screenshots
    for journey_id in args.journey_ids:
        print(f"Loading agent screenshots for journey {journey_id}…")
        try:
            batch = _get_json(base, f"/v1/journeys/{journey_id}/screenshots")
            shots.extend(batch)
            print(f"  → {len(batch)} screenshots")
        except HTTPError as e:
            print(f"  Error: {e}")

    # Human session screenshots
    session_ids = [s.strip() for s in args.sessions.split(",") if s.strip()]
    for sid in session_ids:
        print(f"Loading human screenshots for session {sid}…")
        try:
            batch = _get_json(base, f"/v1/sessions/{sid}/screenshots")
            shots.extend(batch)
            print(f"  → {len(batch)} screenshots")
        except HTTPError as e:
            print(f"  Error: {e}")

    # Deduplicate by id
    seen: set[int] = set()
    shots = [s for s in shots if not (s["id"] in seen or seen.add(s["id"]))]  # type: ignore[func-returns-value]

    if not shots:
        print("No screenshots found.")
        sys.exit(0)

    print(f"Total: {len(shots)} unique screenshots.")
    title = f"Journeys {args.journey_ids}" if args.journey_ids else f"Sessions {session_ids}"

    # Simulate preselection
    categories, scores = simulate_preselection(shots, args.issue)

    # Fetch raw image bytes in parallel
    from concurrent.futures import ThreadPoolExecutor

    raw_images: dict[int, bytes] = {}

    def fetch_image(shot: dict) -> tuple[int, bytes | None]:
        sid = shot["id"]
        if not shot.get("ready", True):
            return sid, None
        try:
            return sid, _get(base, f"/v1/screenshots/{sid}/image")
        except Exception as exc:
            print(f"  Warning: could not fetch image {sid}: {exc}")
            return sid, None

    print(f"Fetching {len(shots)} images…")
    with ThreadPoolExecutor(max_workers=8) as pool:
        for sid, raw in pool.map(fetch_image, shots):
            if raw:
                raw_images[sid] = raw

    print(f"Fetched {len(raw_images)} images.")

    # Build HTML and open
    slug = "_".join(str(j) for j in args.journey_ids) or "sessions"
    html = build_html(title, shots, raw_images, categories, scores, args.issue)

    with tempfile.NamedTemporaryFile(
        suffix=f"_{slug}.html", delete=False, mode="w", encoding="utf-8"
    ) as f:
        f.write(html)
        out = f.name

    print(f"Opening: {out}")
    webbrowser.open(f"file://{out}")


if __name__ == "__main__":
    main()
