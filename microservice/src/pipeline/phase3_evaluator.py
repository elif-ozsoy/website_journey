"""
Phase 3 – Deployed Evaluator
==============================
Plugs the fine-tuned Gemma-4 adapter into Browser-Use and runs it as an agent
on target websites. Simultaneously:

  UX Tracking   — measures trajectory length, backtracking rate, processing time
                  (cognitive-load / UX friction proxy)

  Accessibility — injects axe-core into each DOM and cross-references failures
                  with the VLM's visual inspection of the screenshot

Results are written to a per-session JSON report and returned by the API.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class StepRecord:
    step_index:       int
    url:              str
    action_taken:     str          # e.g. "click [14]"
    som_box:          Optional[int]
    screenshot_path:  str
    processing_ms:    float
    is_backtrack:     bool = False
    a11y_violations:  List[Dict]   = field(default_factory=list)


@dataclass
class SessionReport:
    goal:               str
    site_url:           str
    completed:          bool
    total_steps:        int
    backtrack_count:    int
    backtrack_rate:     float       # backtrack_count / total_steps
    total_ms:           float
    avg_ms_per_step:    float
    cognitive_load_score: float     # composite [0, 1]
    a11y_violations:    List[Dict]  = field(default_factory=list)
    steps:              List[Dict]  = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)


# ── Axe-core accessibility runner ─────────────────────────────────────────────

AXE_INJECT_JS = """
(async () => {
  if (!window.axe) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = arguments[0];
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const results = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] }
  });
  return results.violations.map(v => ({
    id:          v.id,
    impact:      v.impact,
    description: v.description,
    nodes:       v.nodes.length,
  }));
})()
"""

_AXE_CDN = (
    "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js"
)


async def run_axe(page, axe_cdn: str = _AXE_CDN) -> List[Dict]:
    """Inject axe-core into the current page and return violations."""
    try:
        violations = await page.evaluate(AXE_INJECT_JS, axe_cdn)
        return violations or []
    except Exception as e:
        log.warning("axe-core run failed: %s", e)
        return []


# ── VLM visual accessibility check ────────────────────────────────────────────

VISUAL_A11Y_PROMPT = """\
You are an accessibility inspector. Look at this screenshot and identify any
visual accessibility issues such as:
- Text with insufficient colour contrast
- Interactive elements with no visible focus indicator
- Images with no apparent alt-text (purely decorative except for informational images)
- Very small tap targets (< 24×24 px)

List each issue as: "issue_type: brief description". One per line.
If none, respond with "none".
"""


async def vlm_visual_a11y(screenshot_path: str, model, processor) -> List[Dict]:
    """Ask the VLM to spot visual accessibility issues on a screenshot."""
    try:
        from PIL import Image
        import torch

        img = Image.open(screenshot_path).convert("RGB")
        img.thumbnail((896, 896))

        inputs = processor(
            images=img,
            text=VISUAL_A11Y_PROMPT,
            return_tensors="pt",
        ).to(model.device)

        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=200, do_sample=False)
        text = processor.decode(out[0], skip_special_tokens=True)

        # Strip the prompt echo if model repeats it
        if VISUAL_A11Y_PROMPT[:30] in text:
            text = text[text.find(VISUAL_A11Y_PROMPT[:30]) + len(VISUAL_A11Y_PROMPT):]

        issues = []
        for line in text.strip().splitlines():
            line = line.strip()
            if line and line.lower() != "none":
                if ":" in line:
                    issue_type, desc = line.split(":", 1)
                else:
                    issue_type, desc = "visual", line
                issues.append({
                    "source":      "vlm_visual",
                    "issue_type":  issue_type.strip(),
                    "description": desc.strip(),
                })
        return issues
    except Exception as e:
        log.warning("VLM visual a11y check failed: %s", e)
        return []


async def _goto_with_fallback(page, url: str, timeout_ms: int = 120_000) -> None:
    """Navigate with progressively lighter wait conditions for flaky sites."""
    last_error = None
    for wait_until in ("commit", "domcontentloaded", "load"):
        try:
            await page.goto(url, wait_until=wait_until, timeout=timeout_ms)
            return
        except Exception as exc:
            last_error = exc
            log.warning(
                "page.goto failed for %s with wait_until=%s: %s",
                url,
                wait_until,
                exc,
            )
    if last_error is not None:
        raise last_error


# ── UX scoring ────────────────────────────────────────────────────────────────

def compute_cognitive_load(
    total_steps: int,
    backtrack_rate: float,
    avg_ms: float,
    max_reasonable_steps: int = 20,
    max_reasonable_ms: float = 8_000.0,
) -> float:
    """
    Normalised cognitive-load score [0, 1].
    0 = effortless, 1 = maximally confusing / slow.
    """
    step_score     = min(total_steps / max_reasonable_steps, 1.0)
    bt_score       = min(backtrack_rate * 2, 1.0)
    latency_score  = min(avg_ms / max_reasonable_ms, 1.0)
    return round((step_score * 0.4 + bt_score * 0.4 + latency_score * 0.2), 4)


# ── Browser-Use agent wrapper ─────────────────────────────────────────────────

class GemmaWebAgent:
    """
    Wraps Browser-Use's Agent with our fine-tuned Gemma-4 model.
    Tracks UX metrics and runs axe-core on each page.

    Usage:
        agent = GemmaWebAgent(adapter_dir="pipeline_data/adapters/current")
        report = await agent.evaluate(
            goal="Find Creative Cloud pricing",
            start_url="https://www.adobe.com",
        )
    """

    def __init__(
        self,
        adapter_dir: str,
        cfg: Optional[Any] = None,
        max_steps: int = 30,
    ):
        from pipeline.config import PipelineConfig
        self.cfg        = cfg or PipelineConfig()
        self.adapter_dir = adapter_dir
        self.max_steps   = max_steps
        self._model      = None
        self._processor  = None

    def _load_model(self):
        if self._model is not None:
            return
        from pathlib import Path
        from unsloth import FastVisionModel
        
        base_model_id = self.cfg.vlm_model_id
        adapter_path = str(Path(self.adapter_dir).resolve())
        
        log.info("Loading base model %s with adapter from %s ...", base_model_id, adapter_path)
        
        # Load the base model in 4-bit with the adapter
        # Unsloth handles merging adapters into the patched model correctly
        model, processor = FastVisionModel.from_pretrained(
            model_name=base_model_id,
            adapter_name=adapter_path,
            load_in_4bit=True,
            trust_remote_code=True,
        )
        
        FastVisionModel.for_inference(model)
        self._model = model
        self._processor = processor
        log.info("Model + adapter loaded.")

    async def evaluate(
        self,
        goal: str,
        start_url: str,
        output_dir: Optional[str] = None,
    ) -> SessionReport:
        """Run the agent and return a SessionReport."""
        self._load_model()

        output_dir = output_dir or self.cfg.screenshots_dir
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        from playwright.async_api import async_playwright
        from pipeline.phase1_hydration import capture_som_page, INTERACTIVE_SELECTORS

        step_records: List[StepRecord] = []
        url_history: List[str]         = []
        all_a11y: List[Dict]           = []
        completed = False

        async with async_playwright() as pw:
            # Ubuntu 26.04+ doesn't have prebuilt Playwright browsers
            # Try system-installed browsers in order of preference
            import shutil
            
            browser_exe = os.environ.get("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")
            if not browser_exe:
                # Try to find system browser
                candidates = [
                    ("google-chrome", pw.chromium),
                    ("chromium", pw.chromium),
                    ("chromium-browser", pw.chromium),
                    ("firefox", pw.firefox),
                ]
                for browser_name, browser_type in candidates:
                    browser_exe = shutil.which(browser_name)
                    if browser_exe:
                        log.info("Found system %s at %s", browser_name, browser_exe)
                        break
            
            if not browser_exe:
                raise RuntimeError(
                    "No system browser found. Install with: "
                    "sudo apt-get install -y firefox\n"
                    "Or set PLAYWRIGHT_BROWSER_EXECUTABLE_PATH environment variable."
                )
            
            # Detect browser type from executable
            exe_name = os.path.basename(browser_exe).lower()
            if "firefox" in exe_name:
                # Run Firefox in regular mode with virtual display (xvfb-run)
                # Avoids headless rendering issues on systems without GPU
                browser = await pw.firefox.launch(
                    headless=False,  # Use non-headless mode with xvfb-run
                    executable_path=browser_exe,
                    timeout=60_000,
                )
            else:
                browser = await pw.chromium.launch(
                    headless=True,
                    executable_path=browser_exe,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-http2",
                    ],
                )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=True,
            )
            page    = await context.new_page()

            current_url = start_url
            await _goto_with_fallback(page, current_url)

            for step_i in range(self.max_steps):
                t0 = time.perf_counter()

                ss_path  = os.path.join(output_dir, f"eval_{step_i:03d}.png")
                dom_path = os.path.join(output_dir, f"eval_{step_i:03d}.html")

                # Capture SoM screenshot + DOM
                try:
                    som_map = await capture_som_page(page, current_url, ss_path, dom_path)
                except Exception:
                    som_map = {}

                # Axe-core a11y
                page_violations = await run_axe(page)
                all_a11y.extend(page_violations)

                # VLM visual a11y
                vlm_violations = await vlm_visual_a11y(ss_path, self._model, self._processor)
                all_a11y.extend(vlm_violations)

                # Ask VLM which box to click
                som_box, action_str = await self._decide_action(
                    goal, som_map, dom_path, ss_path, step_i
                )

                processing_ms = (time.perf_counter() - t0) * 1000
                is_backtrack  = current_url in url_history[:-1]
                url_history.append(current_url)

                step_records.append(StepRecord(
                    step_index=step_i,
                    url=current_url,
                    action_taken=action_str,
                    som_box=som_box,
                    screenshot_path=ss_path,
                    processing_ms=processing_ms,
                    is_backtrack=is_backtrack,
                    a11y_violations=page_violations + vlm_violations,
                ))

                if som_box is None:
                    log.info("Step %d: agent could not pick an action — stopping.", step_i)
                    break

                # Execute click
                try:
                    selector = som_map.get(str(som_box))
                    if selector:
                        el = await page.query_selector(selector)
                        if el:
                            await el.click(timeout=5_000)
                            await page.wait_for_load_state("domcontentloaded", timeout=30_000)
                    new_url = page.url
                    if new_url == current_url:
                        # Same page — may be a modal or JS-driven interaction
                        pass
                    current_url = new_url

                    # Heuristic task completion
                    if _looks_completed(current_url, goal):
                        completed = True
                        break
                except Exception as e:
                    log.warning("Click failed at step %d: %s", step_i, e)
                    break

            await browser.close()

        # Build report
        n      = len(step_records)
        bts    = sum(1 for s in step_records if s.is_backtrack)
        bt_rt  = bts / n if n else 0.0
        avg_ms = sum(s.processing_ms for s in step_records) / n if n else 0.0
        total_ms = sum(s.processing_ms for s in step_records)

        return SessionReport(
            goal=goal,
            site_url=start_url,
            completed=completed,
            total_steps=n,
            backtrack_count=bts,
            backtrack_rate=round(bt_rt, 4),
            total_ms=round(total_ms, 1),
            avg_ms_per_step=round(avg_ms, 1),
            cognitive_load_score=compute_cognitive_load(n, bt_rt, avg_ms),
            a11y_violations=_dedupe_violations(all_a11y),
            steps=[asdict(s) for s in step_records],
        )

    async def _decide_action(
        self,
        goal: str,
        som_map: Dict[str, str],
        dom_path: str,
        screenshot_path: str,
        step_i: int,
    ) -> Tuple[Optional[int], str]:
        """Ask the VLM which SoM box to click; return (box_num, action_string)."""
        import torch
        from pipeline.phase2_training import build_prompt
        from PIL import Image

        prompt = build_prompt(goal, som_map, dom_path)
        try:
            img = Image.open(screenshot_path).convert("RGB")
            img.thumbnail((896, 896))

            inputs = self._processor(
                images=img, text=prompt,
                return_tensors="pt",
            ).to(self._model.device)

            with torch.no_grad():
                out = self._model.generate(
                    **inputs, max_new_tokens=10, do_sample=False
                )
            raw = self._processor.decode(out[0], skip_special_tokens=True)
            # Extract first integer
            import re
            m = re.search(r"\b(\d+)\b", raw.split(prompt)[-1])
            if m:
                box = int(m.group(1))
                return box, f"click [{box}]"
        except Exception as e:
            log.warning("VLM decision failed at step %d: %s", step_i, e)

        return None, "no_action"


def _looks_completed(url: str, goal: str) -> bool:
    """Rough heuristic: check if URL contains goal-related tokens."""
    goal_tokens = set(goal.lower().split())
    url_lower   = url.lower()
    matches     = sum(1 for t in goal_tokens if len(t) > 4 and t in url_lower)
    return matches >= 2


def _dedupe_violations(violations: List[Dict]) -> List[Dict]:
    seen: set = set()
    out: List[Dict] = []
    for v in violations:
        key = (v.get("id") or v.get("issue_type"), v.get("description", "")[:80])
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


# lazy import guard
import os
