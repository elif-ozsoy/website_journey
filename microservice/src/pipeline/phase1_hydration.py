"""
Phase 1 – Data Hydration
========================
Turns raw Adobe click-data (parquet) into a multi-modal trajectory dataset:

  1. Goal inference   — fast LLM labels the user's explicit goal from the final URL
  2. Wayback fallback — resolves stale/dead URLs via the Wayback Machine CDX API
  3. Visual capture   — Playwright renders each URL, generates a screenshot with
                        Set-of-Mark (SoM) numbered bounding boxes, and dumps the DOM
  4. Action mapping   — translates CSS selectors from Adobe data → SoM box numbers

Output per trajectory (JSONL line in trajectories/hydrated.jsonl):
  {
    "trajectory_id": "adobe_000001",
    "goal":          "Upgrade Creative Cloud subscription",
    "steps": [
      {
        "url":             "https://www.adobe.com/...",
        "resolved_url":    "https://web.archive.org/web/...",   # wayback if needed
        "screenshot_path": "pipeline_data/screenshots/000001_0.png",
        "dom_path":        "pipeline_data/doms/000001_0.html",
        "som_map":         {"3": "a.nav__link", "14": "button.cta-primary"},
        "action": {
          "selector":  "button.cta-primary",
          "som_box":   14,
          "type":      "click"
        }
      },
      ...
    ]
  }
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from pipeline.config import PipelineConfig, WAYBACK_CDX_API, WAYBACK_BASE

log = logging.getLogger(__name__)


# ── Wayback Machine helpers ────────────────────────────────────────────────────

async def resolve_url(url: str, client: httpx.AsyncClient) -> str:
    """
    Return url as-is if reachable; otherwise find the nearest Wayback snapshot.
    """
    try:
        r = await client.head(url, follow_redirects=True, timeout=8.0)
        if r.status_code < 400:
            return url
    except Exception:
        pass

    # Query CDX for the most recent 200 snapshot
    try:
        cdx_params = {
            "url": url,
            "output": "json",
            "limit": "1",
            "fl": "timestamp,original",
            "filter": "statuscode:200",
            "collapse": "digest",
        }
        r = await client.get(WAYBACK_CDX_API, params=cdx_params, timeout=10.0)
        rows = r.json()
        if rows and len(rows) > 1:           # first row is the header
            ts, orig = rows[1]
            wb_url = f"{WAYBACK_BASE}/{ts}/{orig}"
            log.info("Wayback fallback: %s → %s", url, wb_url)
            return wb_url
    except Exception as e:
        log.warning("Wayback lookup failed for %s: %s", url, e)

    return url  # best-effort: return original even if stale


# ── Goal inference ─────────────────────────────────────────────────────────────

GOAL_PROMPT = """\
You are a UX analyst. Given a user's final destination URL in a web session,
infer their explicit top-level goal in 2–6 words (e.g. "Upgrade subscription",
"Download free trial", "Find contact support").

URL: {url}

Respond with ONLY the goal phrase, no punctuation, no quotes.
"""


async def infer_goal(final_url: str, model: str) -> str:
    """Call a fast LLM to label the user goal from the session's last URL."""
    try:
        import litellm  # lazy import — only needed for phase 1
        response = await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": GOAL_PROMPT.format(url=final_url)}],
            max_tokens=20,
            temperature=0.0,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        log.warning("Goal inference failed for %s: %s", final_url, e)
        # Derive a rough goal from the URL path as fallback
        from urllib.parse import urlparse as _urlparse
        path = re.sub(r"[/_-]+", " ", _urlparse(final_url).path).strip()
        return path[:60] if path else "Navigate site"


# ── Set-of-Mark (SoM) screenshot capture ─────────────────────────────────────

# Interactive element selectors we label
INTERACTIVE_SELECTORS = (
    "a[href], button, input, select, textarea, "
    "[role='button'], [role='link'], [role='menuitem'], "
    "[role='tab'], [role='checkbox'], [role='radio']"
)

LABEL_COLORS = [
    (255, 80, 80), (80, 160, 255), (80, 220, 120),
    (255, 200, 50), (200, 100, 255), (255, 140, 0),
]


async def capture_som_page(
    page,  # playwright Page
    url: str,
    screenshot_path: str,
    dom_path: str,
) -> Dict[str, str]:
    """
    Navigate to url, capture:
      - screenshot_path : PNG with SoM numbered bounding boxes
      - dom_path        : full outerHTML of the page
    Returns som_map: {"<box_number>": "<css_selector>"}
    """
    await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(1500)   # let JS settle

    # Dump DOM
    dom_html = await page.content()
    Path(dom_path).parent.mkdir(parents=True, exist_ok=True)
    Path(dom_path).write_text(dom_html, encoding="utf-8")

    # Get bounding boxes for interactive elements
    elements = await page.query_selector_all(INTERACTIVE_SELECTORS)

    som_map: Dict[str, str] = {}
    boxes: List[Dict[str, Any]] = []
    box_num = 1

    for el in elements:
        try:
            bb = await el.bounding_box()
            if bb is None or bb["width"] < 2 or bb["height"] < 2:
                continue
            tag = await el.evaluate("e => e.tagName.toLowerCase()")
            sel = await _best_selector(el, tag)
            som_map[str(box_num)] = sel
            boxes.append({"num": box_num, **bb})
            box_num += 1
        except Exception:
            continue

    # Take base screenshot
    raw_png = await page.screenshot(full_page=False, type="png")
    img = Image.open(io.BytesIO(raw_png)).convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    except Exception:
        font = ImageFont.load_default()

    for b in boxes:
        color = LABEL_COLORS[(b["num"] - 1) % len(LABEL_COLORS)]
        x, y, w, h = b["x"], b["y"], b["width"], b["height"]
        # Semi-transparent fill
        draw.rectangle([x, y, x + w, y + h], outline=color + (220,), width=2)
        # Label badge
        label = str(b["num"])
        lw = len(label) * 8 + 4
        draw.rectangle([x, y - 16, x + lw, y], fill=color + (230,))
        draw.text((x + 2, y - 15), label, fill=(255, 255, 255), font=font)

    Path(screenshot_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(screenshot_path, format="PNG")

    return som_map


async def _best_selector(el, tag: str) -> str:
    """Build a short, unique-ish CSS selector for an element."""
    try:
        id_ = await el.get_attribute("id")
        if id_:
            return f"#{id_}"
        cls = await el.get_attribute("class") or ""
        classes = ".".join(c for c in cls.split() if c)
        if classes:
            return f"{tag}.{classes[:60]}"
    except Exception:
        pass
    return tag


# ── Adobe dataset reader ───────────────────────────────────────────────────────

def load_adobe_parquet(parquet_path: str) -> pd.DataFrame:
    """
    Load Adobe RUM/OpTel click data.
    Accepts:
      - a single .parquet file path
      - a directory  — loads and concatenates all *.parquet files inside it
      - a glob pattern (e.g. "research/data/adobe-com-*.parquet")

    Expected columns: page_url, click_target_url, click_source, weight, event_time
    """
    import glob as _glob

    path = Path(parquet_path)

    if path.is_dir():
        files = sorted(path.glob("*.parquet"))
        if not files:
            raise FileNotFoundError(f"No .parquet files found in directory: {parquet_path}")
    elif "*" in parquet_path or "?" in parquet_path:
        files = sorted(Path(f) for f in _glob.glob(parquet_path))
        if not files:
            raise FileNotFoundError(f"No files matched glob: {parquet_path}")
    elif path.is_file():
        files = [path]
    else:
        raise FileNotFoundError(
            f"{parquet_path!r} is not a file, directory, or glob that matches anything.\n"
            f"Available files in that directory:\n"
            + "\n".join(f"  {p}" for p in sorted(path.parent.glob("*.parquet")))
        )

    log.info("Loading %d parquet file(s) …", len(files))
    frames = []
    for f in files:
        chunk = pd.read_parquet(f)
        required = {"page_url", "click_target_url", "click_source"}
        missing  = required - set(chunk.columns)
        if missing:
            raise ValueError(f"{f}: missing columns {missing}")
        frames.append(chunk)

    df = pd.concat(frames, ignore_index=True)
    log.info("Loaded %d rows from %d file(s)", len(df), len(files))
    return df


def build_trajectories(df: pd.DataFrame) -> List[List[Dict[str, str]]]:
    """
    Reconstruct ordered step lists from the flat click table.
    Only rows with a real click_target_url (non-null, non-empty, http*) are used.

    Vectorised: avoids iterrows() so it stays fast on 40M+ row dataframes.
    Returns list of trajectories, each a list of step dicts.
    """
    # ── Filter to navigational clicks only ────────────────────────────────────
    mask = (
        df["click_target_url"].notna()
        & df["click_target_url"].str.strip().ne("")
        & df["click_target_url"].str.startswith("http", na=False)
    )
    nav = df[mask].copy()
    nav["click_source"] = nav["click_source"].fillna("").astype(str)
    nav["weight"]       = pd.to_numeric(nav.get("weight", 1), errors="coerce").fillna(1)

    log.info("Navigational clicks: %d / %d", len(nav), len(df))

    # ── Keep only the highest-weight transition per (page_url, click_target_url)
    nav = (
        nav.sort_values("weight", ascending=False)
           .drop_duplicates(subset=["page_url", "click_target_url"])
    )

    # ── Build top-1 transition dict: page_url → best next step ────────────────
    # For each source page keep the single highest-weight outbound click
    best = (
        nav.sort_values("weight", ascending=False)
           .groupby("page_url", sort=False)
           .first()
           .reset_index()
    )[["page_url", "click_source", "click_target_url"]]

    transitions: Dict[str, Dict[str, str]] = {
        row.page_url: {
            "page_url":         row.page_url,
            "click_source":     row.click_source,
            "click_target_url": row.click_target_url,
        }
        for row in best.itertuples(index=False, name="Row")
    }

    # ── Find entry pages (no inbound links in the transition graph) ───────────
    all_targets  = set(best["click_target_url"])
    all_sources  = set(best["page_url"])
    entry_pages  = list(all_sources - all_targets)

    log.info("Unique source pages: %d | entry pages: %d", len(all_sources), len(entry_pages))

    # ── Walk chains ───────────────────────────────────────────────────────────
    trajectories: List[List[Dict]] = []
    for start in entry_pages:
        traj: List[Dict] = []
        visited: set = set()
        current = start
        while current in transitions and current not in visited:
            visited.add(current)
            step = transitions[current]
            traj.append(step)
            current = step["click_target_url"]
        if len(traj) >= 2:
            trajectories.append(traj)

    return trajectories


# ── Main hydration entry-point ────────────────────────────────────────────────

class DataHydrator:
    """
    Orchestrates Phase 1: parquet → multi-modal trajectory JSONL.

    Usage:
        hydrator = DataHydrator(cfg)
        await hydrator.run(parquet_path="research/data/adobe.parquet",
                           output_path="pipeline_data/trajectories/hydrated.jsonl")
    """

    def __init__(self, cfg: Optional[PipelineConfig] = None):
        self.cfg = cfg or PipelineConfig()
        self.cfg.make_dirs()

    async def run(
        self,
        parquet_path: str,
        output_path: Optional[str] = None,
        max_trajectories: int = 5000,
        concurrency: int = 4,
    ) -> str:
        from playwright.async_api import async_playwright

        output_path = output_path or os.path.join(
            self.cfg.trajectories_dir, "hydrated.jsonl"
        )
        log.info("Loading Adobe parquet: %s", parquet_path)
        df = load_adobe_parquet(parquet_path)
        trajectories = build_trajectories(df)[:max_trajectories]
        log.info("Built %d trajectories", len(trajectories))

        sem = asyncio.Semaphore(concurrency)
        results: List[Dict] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 800})

            async with httpx.AsyncClient() as http_client:
                async def process(traj_id: int, steps: List[Dict]) -> Optional[Dict]:
                    async with sem:
                        return await self._hydrate_trajectory(
                            traj_id, steps, context, http_client
                        )

                tasks = [
                    process(i, traj)
                    for i, traj in enumerate(trajectories)
                ]
                for coro in asyncio.as_completed(tasks):
                    result = await coro
                    if result:
                        results.append(result)
                        if len(results) % 100 == 0:
                            log.info("Hydrated %d / %d", len(results), len(trajectories))

            await browser.close()

        # Write output JSONL
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            for rec in results:
                f.write(json.dumps(rec) + "\n")

        log.info("Saved %d hydrated trajectories → %s", len(results), output_path)
        return output_path

    async def _hydrate_trajectory(
        self,
        traj_id: int,
        raw_steps: List[Dict],
        context,
        http_client: httpx.AsyncClient,
    ) -> Optional[Dict]:
        final_url = raw_steps[-1]["click_target_url"]
        goal = await infer_goal(final_url, self.cfg.goal_llm_model)

        hydrated_steps: List[Dict] = []
        page = await context.new_page()

        try:
            for step_i, raw in enumerate(raw_steps):
                orig_url = raw["page_url"]
                resolved = await resolve_url(orig_url, http_client)

                ss_path  = os.path.join(
                    self.cfg.screenshots_dir, f"{traj_id:06d}_{step_i}.png"
                )
                dom_path = os.path.join(
                    self.cfg.doms_dir, f"{traj_id:06d}_{step_i}.html"
                )

                try:
                    som_map = await capture_som_page(page, resolved, ss_path, dom_path)
                except Exception as e:
                    log.debug("Screenshot failed for %s: %s", resolved, e)
                    som_map = {}

                # Map CSS selector → SoM box number
                selector  = raw.get("click_source", "")
                som_box   = _selector_to_som(selector, som_map)

                hydrated_steps.append({
                    "url":             orig_url,
                    "resolved_url":    resolved,
                    "screenshot_path": ss_path,
                    "dom_path":        dom_path,
                    "som_map":         som_map,
                    "action": {
                        "selector": selector,
                        "som_box":  som_box,
                        "type":     "click",
                    },
                })
        finally:
            await page.close()

        if not hydrated_steps:
            return None

        return {
            "trajectory_id": f"adobe_{traj_id:06d}",
            "goal":          goal,
            "steps":         hydrated_steps,
        }


def _selector_to_som(selector: str, som_map: Dict[str, str]) -> Optional[int]:
    """
    Find which SoM box number corresponds to a given CSS selector.
    Uses substring matching as selectors are rarely identical.
    """
    if not selector:
        return None
    # Exact match first
    for box_num, mapped_sel in som_map.items():
        if mapped_sel == selector:
            return int(box_num)
    # Partial match — both must share a meaningful token
    sel_tokens = set(re.split(r"[.#\s>+~\[\]=:]+", selector)) - {"", "*"}
    best_box, best_overlap = None, 0
    for box_num, mapped_sel in som_map.items():
        mapped_tokens = set(re.split(r"[.#\s>+~\[\]=:]+", mapped_sel)) - {"", "*"}
        overlap = len(sel_tokens & mapped_tokens)
        if overlap > best_overlap:
            best_overlap, best_box = overlap, int(box_num)
    return best_box
