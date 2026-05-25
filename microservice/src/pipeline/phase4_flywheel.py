"""
Phase 4 – Data Flywheel (Batch-Online Learning)
================================================
Three data sources feed into nightly QLoRA adapter updates:

  1. Behavioral Cloning (volume)
     Human testers complete tasks with a browser extension that silently records
     DOM, screenshots, and clicks → ingested via POST /inference/ingest-human-trajectory

  2. Human-in-the-Loop (robustness)
     Humans watch the model navigate and submit corrections →
     POST /inference/ingest-correction

  3. Nightly update
     - Load all new human trajectories collected since last run
     - Sample a replay buffer (REPLAY_RATIO %) from the original Adobe trajectories
       to prevent catastrophic forgetting
     - Run a QLoRA fine-tuning pass on the combined dataset

The updated adapter is saved with a timestamp; the symlink
"pipeline_data/adapters/current" always points to the latest.
"""
from __future__ import annotations

import json
import logging
import os
import random
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from pipeline.config import PipelineConfig

log = logging.getLogger(__name__)


# ── Human trajectory ingestion ────────────────────────────────────────────────

def ingest_human_trajectory(
    trajectory: Dict,
    cfg: Optional[PipelineConfig] = None,
) -> str:
    """
    Persist a human-recorded trajectory dict to the human_data_dir.
    Validates minimal structure and writes a timestamped JSONL entry.

    Expected schema (mirrors hydrated trajectory but produced by the extension):
      {
        "goal":    "...",
        "site":    "https://...",
        "steps": [
          {
            "url":             "...",
            "screenshot_b64":  "...",   # base64-encoded PNG from extension
            "dom_html":        "...",   # full page DOM
            "action": {
              "type":       "click",
              "selector":   "button.cta",
              "som_box":    null        # resolved server-side
            }
          }
        ]
      }
    """
    cfg = cfg or PipelineConfig()
    cfg.make_dirs()

    # Basic validation
    if "steps" not in trajectory or not trajectory["steps"]:
        raise ValueError("trajectory must contain at least one step")
    if "goal" not in trajectory:
        raise ValueError("trajectory must contain 'goal'")

    # Materialise any base64 screenshots to disk
    for i, step in enumerate(trajectory["steps"]):
        b64 = step.pop("screenshot_b64", None)
        if b64:
            import base64
            img_path = os.path.join(
                cfg.screenshots_dir,
                f"human_{int(time.time())}_{i}.png",
            )
            Path(img_path).parent.mkdir(parents=True, exist_ok=True)
            Path(img_path).write_bytes(base64.b64decode(b64))
            step["screenshot_path"] = img_path

        # Materialise DOM
        dom_html = step.pop("dom_html", None)
        if dom_html:
            dom_path = os.path.join(
                cfg.doms_dir,
                f"human_{int(time.time())}_{i}.html",
            )
            Path(dom_path).parent.mkdir(parents=True, exist_ok=True)
            Path(dom_path).write_text(dom_html, encoding="utf-8")
            step["dom_path"] = dom_path

    # Assign trajectory ID
    trajectory.setdefault(
        "trajectory_id", f"human_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}"
    )

    out_path = os.path.join(cfg.human_data_dir, "human_trajectories.jsonl")
    with open(out_path, "a") as f:
        f.write(json.dumps(trajectory) + "\n")

    log.info("Ingested human trajectory %s → %s", trajectory["trajectory_id"], out_path)
    return trajectory["trajectory_id"]


def ingest_correction(
    correction: Dict,
    cfg: Optional[PipelineConfig] = None,
) -> str:
    """
    Persist a human correction to the human data store.

    Expected schema:
      {
        "trajectory_id":   "eval_session_xyz",
        "step_index":      3,
        "wrong_som_box":   7,
        "correct_som_box": 14,
        "goal":            "...",
        "screenshot_path": "pipeline_data/screenshots/eval_003.png",
        "dom_path":        "pipeline_data/doms/eval_003.html",
        "som_map":         {"14": "button.cta", ...}
      }
    """
    cfg = cfg or PipelineConfig()
    cfg.make_dirs()

    required = {"trajectory_id", "step_index", "correct_som_box", "goal"}
    missing  = required - set(correction.keys())
    if missing:
        raise ValueError(f"Correction missing fields: {missing}")

    # Store as a synthetic single-step trajectory so the training loop
    # can treat corrections identically to behavioral-cloning data
    synthetic = {
        "trajectory_id": f"correction_{correction['trajectory_id']}_step{correction['step_index']}",
        "goal":          correction["goal"],
        "source":        "human_correction",
        "steps": [{
            "screenshot_path": correction.get("screenshot_path", ""),
            "dom_path":        correction.get("dom_path", ""),
            "som_map":         correction.get("som_map", {}),
            "action": {
                "selector": correction.get("som_map", {}).get(
                    str(correction["correct_som_box"]), ""
                ),
                "som_box": correction["correct_som_box"],
                "type":    "click",
            },
        }],
    }

    out_path = os.path.join(cfg.human_data_dir, "corrections.jsonl")
    with open(out_path, "a") as f:
        f.write(json.dumps(synthetic) + "\n")

    log.info("Ingested correction for %s step %d", correction["trajectory_id"],
             correction["step_index"])
    return synthetic["trajectory_id"]


# ── Replay buffer ─────────────────────────────────────────────────────────────

def sample_replay_buffer(
    replay_path: str,
    n_samples: int,
    rng: Optional[random.Random] = None,
) -> List[Dict]:
    """Reservoir-sample n_samples lines from the Adobe replay buffer JSONL."""
    rng = rng or random.Random(42)
    reservoir: List[Dict] = []

    if not os.path.exists(replay_path):
        log.warning("Replay buffer not found at %s — skipping", replay_path)
        return []

    with open(replay_path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            if i < n_samples:
                reservoir.append(item)
            else:
                j = rng.randint(0, i)
                if j < n_samples:
                    reservoir[j] = item

    return reservoir


# ── Nightly update ────────────────────────────────────────────────────────────

class NightlyUpdater:
    """
    Runs a nightly QLoRA adapter update.

    1. Loads all new human trajectories since last update.
    2. Samples replay_ratio % from the Adobe replay buffer.
    3. Writes a combined temp JSONL and calls VLMTrainer.train().
    4. Saves the new adapter with a timestamp, updates the 'current' symlink.

    Usage:
        updater = NightlyUpdater(cfg)
        updater.run(
            base_trajectory_jsonl="pipeline_data/trajectories/hydrated.jsonl",
        )
    """

    def __init__(self, cfg: Optional[PipelineConfig] = None):
        self.cfg = cfg or PipelineConfig()

    def run(
        self,
        base_trajectory_jsonl: str,
        current_adapter_dir: Optional[str] = None,
    ) -> str:
        from pipeline.phase2_training import VLMTrainer

        current_adapter_dir = current_adapter_dir or os.path.join(
            self.cfg.adapter_dir, "current"
        )

        # ── Collect new human data ─────────────────────────────────────────────
        human_lines = self._load_human_data()
        log.info("New human trajectories: %d", len(human_lines))

        if not human_lines:
            log.info("No new human data — skipping nightly update.")
            return current_adapter_dir

        # ── Sample replay buffer ───────────────────────────────────────────────
        n_replay = max(1, int(len(human_lines) * self.cfg.replay_ratio /
                               (1 - self.cfg.replay_ratio)))
        replay_items = sample_replay_buffer(base_trajectory_jsonl, n_replay)
        log.info("Replay buffer samples: %d (%.0f%%)",
                 len(replay_items), self.cfg.replay_ratio * 100)

        # ── Write combined temp JSONL ──────────────────────────────────────────
        combined_path = os.path.join(self.cfg.base_dir, "_nightly_combined.jsonl")
        all_items = human_lines + replay_items
        random.shuffle(all_items)
        with open(combined_path, "w") as f:
            for item in all_items:
                f.write(json.dumps(item) + "\n")
        log.info("Combined training set: %d trajectories", len(all_items))

        # ── QLoRA update ───────────────────────────────────────────────────────
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        new_adapter_dir = os.path.join(self.cfg.adapter_dir, f"adapter_{ts}")

        trainer = VLMTrainer(self.cfg)
        trainer.train(
            train_jsonl=combined_path,
            output_adapter_dir=new_adapter_dir,
            resume_adapter=current_adapter_dir if os.path.isdir(current_adapter_dir) else None,
        )

        # ── Update 'current' symlink ───────────────────────────────────────────
        current_link = os.path.join(self.cfg.adapter_dir, "current")
        if os.path.islink(current_link) or os.path.exists(current_link):
            os.remove(current_link)
        os.symlink(new_adapter_dir, current_link)
        log.info("Updated 'current' adapter → %s", new_adapter_dir)

        # ── Archive processed human data ──────────────────────────────────────
        self._archive_human_data(ts)

        # Clean up temp file
        try:
            os.remove(combined_path)
        except Exception:
            pass

        return new_adapter_dir

    def _load_human_data(self) -> List[Dict]:
        items: List[Dict] = []
        for fname in ("human_trajectories.jsonl", "corrections.jsonl"):
            path = os.path.join(self.cfg.human_data_dir, fname)
            if not os.path.exists(path):
                continue
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            items.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
        return items

    def _archive_human_data(self, timestamp: str) -> None:
        """Move processed human data to an archive directory."""
        archive_dir = os.path.join(self.cfg.human_data_dir, "archive", timestamp)
        os.makedirs(archive_dir, exist_ok=True)
        for fname in ("human_trajectories.jsonl", "corrections.jsonl"):
            src = os.path.join(self.cfg.human_data_dir, fname)
            if os.path.exists(src):
                shutil.move(src, os.path.join(archive_dir, fname))
        log.info("Archived processed human data to %s", archive_dir)
