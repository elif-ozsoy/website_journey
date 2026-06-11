"""Screenshot vision endpoints: annotate-screenshot and select-screenshot.

Both endpoints degrade gracefully — when every LLM provider fails they return
a usable fallback (centre dot / first candidate) instead of an error, because
a missing annotation should not break the dashboard.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import struct
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_db
from services.llm_client import call_llm, resolve_keys

router = APIRouter()
logger = logging.getLogger(__name__)


class AnnotateRequest(BaseModel):
    screenshot_id: int
    issue_text: str


class AnnotationPoint(BaseModel):
    x: float   # centre x, 0–100 (percentage)
    y: float   # centre y, 0–100 (percentage)
    label: str # one sentence: what to change here
    glyph: str = "warning"  # error | warning | friction | missing | improve


class AnnotateResponse(BaseModel):
    found: bool
    points: list[AnnotationPoint] = []
    # legacy fields kept for back-compat
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class SelectScreenshotRequest(BaseModel):
    screenshot_ids: list[int]
    issue_text: str


class SelectScreenshotResponse(BaseModel):
    screenshot_id: int | None  # None if none match


_ANNOTATE_SYSTEM = (
    "You are a UI/UX expert annotating a website screenshot. "
    "Given the screenshot and a UX issue description, place 1–4 annotation dots on the most relevant parts of the visible page. "
    "For each dot choose the glyph that best describes the nature of the problem at that location:\n"
    '  • "error"    — broken element, wrong link/URL, layout bug, 404, crash\n'
    '  • "warning"  — misleading label, confusing copy, wrong destination, unclear CTA\n'
    '  • "friction" — element exists but is hard to find, buried, requires too many steps\n'
    '  • "missing"  — a needed element is absent; place the dot where it should appear\n'
    '  • "improve"  — element works but could be significantly better (contrast, size, placement)\n'
    "x and y are PERCENTAGES (0–100) of image width/height from the top-left corner — "
    "measure carefully from the actual position of the element in the screenshot, not from the center. "
    "You MUST always place at least one dot. "
    "If the screenshot matches the issue imperfectly, place a dot on whichever visible element is most related. "
    "Return ONLY valid JSON, no markdown, always with found=true: "
    '{\"found\": true, \"points\": [{\"x\": 72, \"y\": 18, \"glyph\": \"warning\", \"label\": \"element description\"}, ...]}.'
)

_SELECT_SYSTEM = (
    "You are given several website screenshots and a UX action point. "
    "Pick the single screenshot that is MOST relevant — it shows the page or UI area being discussed. "
    "Prefer a match even if imperfect: choose the closest screenshot rather than returning null. "
    "Only return null if every screenshot shows a completely unrelated page and the action point "
    "is about something entirely invisible (e.g. email delivery, server errors, background jobs). "
    "Reply ONLY with a JSON object: {\"index\": <0-based integer>} or {\"index\": null}."
)

VALID_GLYPHS = ("error", "warning", "friction", "missing", "improve")


# ─── Pure helpers (unit-tested in tests/test_annotate_parsing.py) ────────────

def detect_media_type(raw: bytes) -> str:
    """Detect image MIME type from magic bytes; PNG is the safe fallback."""
    if raw[:4] == b'\x89PNG':
        return "image/png"
    if raw[:2] in (b'\xff\xd8', b'\xff\xe0', b'\xff\xe1'):
        return "image/jpeg"
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return "image/webp"
    return "image/png"


def png_dimensions(raw: bytes, default: tuple[int, int] = (1920, 1080)) -> tuple[int, int]:
    """Read PNG width/height (big-endian uint32 at bytes 16–24); default for non-PNG."""
    if raw[:4] != b'\x89PNG':
        return default
    try:
        w = struct.unpack('>I', raw[16:20])[0]
        h = struct.unpack('>I', raw[20:24])[0]
        return w, h
    except Exception:
        return default


def strip_code_fences(raw: str) -> str:
    """Remove a surrounding markdown code fence (```json … ```) if present."""
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def parse_annotation_points(raw_text: str, img_w: int, img_h: int) -> list[AnnotationPoint]:
    """Parse the model's annotation JSON into validated points.

    Returns [] when the response is unparseable or contains no valid points —
    the caller decides on the fallback. Pixel coordinates (values > 100) are
    normalised to percentages using the image dimensions.
    """
    try:
        data = json.loads(strip_code_fences(raw_text))
    except Exception:
        return []
    pts: list[AnnotationPoint] = []
    for p in data.get("points", []) if isinstance(data, dict) else []:
        try:
            x = float(p["x"])
            y = float(p["y"])
            # Model sometimes returns pixel coords instead of percentages.
            # Normalise: if either value is > 100 treat both as pixels.
            if x > 100 or y > 100:
                x = x / img_w * 100
                y = y / img_h * 100
            x = max(0.0, min(100.0, x))
            y = max(0.0, min(100.0, y))
            glyph = str(p.get("glyph", "warning"))
            if glyph not in VALID_GLYPHS:
                glyph = "warning"
            pts.append(AnnotationPoint(x=x, y=y, label=str(p.get("label", "")), glyph=glyph))
        except Exception:
            continue
    return pts


def parse_selection_index(raw_text: str, n_candidates: int) -> int | None | str:
    """Parse the model's selection JSON.

    Returns the index (int) when valid, None when the model explicitly said
    no match, or the sentinel string "invalid" when the response is unusable.
    """
    try:
        data = json.loads(strip_code_fences(raw_text))
    except Exception:
        return "invalid"
    idx = data.get("index") if isinstance(data, dict) else "invalid"
    if idx is None:
        return None
    if not isinstance(idx, int) or not (0 <= idx < n_candidates):
        return "invalid"
    return idx


# ─── Annotate endpoint ───────────────────────────────────────────────────────

@router.post("/annotate-screenshot", response_model=AnnotateResponse)
async def annotate_screenshot(
    body: AnnotateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AnnotateResponse:
    anthropic_key, google_key = resolve_keys(request)

    from models.screenshot import Screenshot
    sc = db.get(Screenshot, body.screenshot_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    if sc.data:
        raw_bytes = sc.data
    elif sc.file_path and os.path.exists(sc.file_path):
        with open(sc.file_path, "rb") as f:
            raw_bytes = f.read()
    else:
        raise HTTPException(status_code=404, detail="Screenshot data not available")

    img_b64 = base64.b64encode(raw_bytes).decode()
    media_type = detect_media_type(raw_bytes)
    img_w, img_h = png_dimensions(raw_bytes)

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 300,
        "system": _ANNOTATE_SYSTEM,
        "messages": [
            # Few-shot: issue area clearly visible in screenshot
            {
                "role": "user",
                "content": "UX issue: No prominent call-to-action button is visible above the fold; users must scroll to find it.",
            },
            {
                "role": "assistant",
                "content": '{"found": true, "points": [{"x": 50, "y": 28, "glyph": "missing", "label": "Above-fold area — no CTA visible here"}, {"x": 50, "y": 84, "glyph": "improve", "label": "Existing CTA too small and low-contrast; hard to spot"}]}',
            },
            # Few-shot: navigation issue visible in header
            {
                "role": "user",
                "content": "UX issue: Users struggle to find the back-navigation control; dropdown menu is the only way back.",
            },
            {
                "role": "assistant",
                "content": '{"found": true, "points": [{"x": 8, "y": 7, "glyph": "friction", "label": "Navigation bar — only way back, no persistent back button"}, {"x": 50, "y": 6, "glyph": "missing", "label": "Add back-navigation control here"}]}',
            },
            # Actual request
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_b64}},
                    {"type": "text", "text": f"UX issue: {body.issue_text}"},
                ],
            },
        ],
    }

    def _fallback() -> AnnotateResponse:
        label = body.issue_text[:80].rstrip() + ("…" if len(body.issue_text) > 80 else "")
        return AnnotateResponse(found=True, points=[AnnotationPoint(x=50.0, y=40.0, label=label)], x=50.0, y=40.0, width=0.1, height=0.05)

    try:
        raw_text = (await call_llm(payload, anthropic_key, google_key, timeout=60.0, attempts=4)).strip()
    except Exception as exc:
        logger.warning("annotate_screenshot: all LLM providers failed: %s", exc)
        return _fallback()

    pts = parse_annotation_points(raw_text, img_w, img_h)
    if not pts:
        return _fallback()
    first = pts[0]
    return AnnotateResponse(found=True, points=pts, x=first.x, y=first.y, width=0.1, height=0.05)


# ─── Select-screenshot endpoint ──────────────────────────────────────────────

TOP_K = 10   # max screenshots sent to Claude for selection
MIN_K = 4    # always send at least this many if available

_TRIGGER_RANK = {"click": 3, "navigate": 3, "input": 2, "scroll": 1}


def dedup_indices_by_path(paths: list[str | None]) -> list[int]:
    """Keep at most the first + last occurrence per unique path.

    One page can't dominate the candidate set; first/last are kept because the
    initial render and the final state of a page differ the most.
    Returns kept indices in original order.
    """
    by_path: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(paths):
        by_path[p or ""].append(i)
    kept: list[int] = []
    for indices in by_path.values():
        kept.append(indices[0])
        if len(indices) > 1:
            kept.append(indices[-1])
    kept.sort()
    return kept


def heuristic_score(sc: Any, words: set[str]) -> float:
    """Path-keyword / trigger / journey-position heuristic for a screenshot row."""
    path = (sc.path or "").lower()
    trigger = (sc.trigger or "").lower()
    path_kw = sum(1 for w in words if w in path)
    trigger_score = max(
        (_TRIGGER_RANK.get(t, 0) for t in _TRIGGER_RANK if t in trigger),
        default=0,
    )
    try:
        step = int(sc.action_id or 0)
    except (ValueError, TypeError):
        step = 999
    # Prefer steps in the first half of the journey where friction typically begins
    step_score = max(0, 10 - step) / 10.0
    return path_kw * 3 + trigger_score + step_score


@router.post("/select-screenshot", response_model=SelectScreenshotResponse)
async def select_screenshot(
    body: SelectScreenshotRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SelectScreenshotResponse:
    anthropic_key, google_key = resolve_keys(request)
    if not body.screenshot_ids:
        return SelectScreenshotResponse(screenshot_id=None)

    from models.screenshot import Screenshot

    # Resolve every candidate ID → (id, file_path_or_none, screenshot_row)
    # Accepts both file-backed and DB-blob screenshots.
    resolved: list[tuple[int, str | None, Any]] = []
    for sid in body.screenshot_ids:
        sc = db.get(Screenshot, sid)
        if not sc:
            continue
        if sc.data:
            resolved.append((sid, None, sc))
        elif sc.file_path and os.path.exists(sc.file_path):
            resolved.append((sid, sc.file_path, sc))

    if not resolved:
        return SelectScreenshotResponse(screenshot_id=None)

    if len(resolved) > TOP_K:
        deduped = dedup_indices_by_path([sc.path for _, _, sc in resolved])
        resolved_deduped = [resolved[i] for i in deduped]
        logger.info("select_screenshot: deduped %d→%d across %d unique paths",
                    len(resolved), len(resolved_deduped),
                    len({sc.path or "" for _, _, sc in resolved}))

        # If deduplication left fewer than MIN_K candidates, add back extras
        # from the full resolved list so Claude always has a meaningful choice.
        if len(resolved_deduped) < MIN_K:
            seen_ids = {sid for sid, _, _ in resolved_deduped}
            for r in resolved:
                if len(resolved_deduped) >= MIN_K:
                    break
                if r[0] not in seen_ids:
                    resolved_deduped.append(r)
                    seen_ids.add(r[0])
            logger.info("select_screenshot: padded deduped pool to %d to meet MIN_K=%d",
                        len(resolved_deduped), MIN_K)

        if len(resolved_deduped) <= TOP_K:
            resolved = resolved_deduped
        else:
            # Step 2: combine path/trigger/step heuristics with CLIP-based visual
            # relevance and use MMR to pick TOP_K diverse, relevant screenshots.
            # Pure CLIP alone over-selects content-heavy pages; blending it with
            # heuristics keeps interaction context dominant while CLIP breaks
            # ties by visual match.  MMR then prevents sending near-identical
            # frames to Claude.
            words = {w for w in body.issue_text.lower().split() if len(w) > 3}
            h_scores = [heuristic_score(sc, words) for _, _, sc in resolved_deduped]

            # Build image sources for CLIP (bytes preferred; file path as fallback)
            clip_sources: list[str | bytes] = [
                sc.data if sc.data else (fp or b"")
                for _, fp, sc in resolved_deduped
            ]

            from services.clip_service import mmr_select
            selected_indices = await mmr_select(
                body.issue_text, clip_sources, h_scores, top_k=TOP_K
            )
            resolved = [resolved_deduped[i] for i in selected_indices]
            logger.info(
                "select_screenshot: MMR selected %d from %d — paths/hscores: %s",
                len(resolved),
                len(resolved_deduped),
                [(resolved_deduped[i][2].path, resolved_deduped[i][2].trigger, round(h_scores[i], 2))
                 for i in selected_indices],
            )

    # Build the vision payload for Claude
    images: list[dict] = []
    id_order: list[int] = []
    for sid, file_path, sc in resolved:
        if sc.data:
            raw = sc.data
        else:
            with open(file_path, "rb") as f:
                raw = f.read()
        data = base64.b64encode(raw).decode()
        media_type = detect_media_type(raw)
        images.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
        images.append({"type": "text", "text": f"[Screenshot {len(id_order)}] page: {sc.path or ''}"})
        id_order.append(sid)

    if not id_order:
        return SelectScreenshotResponse(screenshot_id=None)

    content = images + [{"type": "text", "text": f"Action point: {body.issue_text}"}]
    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 64,
        "system": _SELECT_SYSTEM,
        "messages": [
            {"role": "user", "content": content},
        ],
    }

    try:
        raw_text = (await call_llm(payload, anthropic_key, google_key, timeout=60.0, attempts=3)).strip()
    except Exception as exc:
        logger.warning("select_screenshot: all LLM providers failed: %s", exc)
        return SelectScreenshotResponse(screenshot_id=id_order[0])

    logger.info("select_screenshot: LLM raw response: %s | candidates: %d", raw_text[:120], len(id_order))
    idx = parse_selection_index(raw_text, len(id_order))
    if idx is None:
        return SelectScreenshotResponse(screenshot_id=None)
    if idx == "invalid":
        return SelectScreenshotResponse(screenshot_id=id_order[0])
    logger.info("select_screenshot: picked index=%s → screenshot_id=%s", idx, id_order[idx])
    return SelectScreenshotResponse(screenshot_id=id_order[idx])
