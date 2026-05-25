"""
Phase 4 CLI – Nightly QLoRA Update

Mixes the day's human trajectories with a replay buffer of Adobe data
and runs an incremental QLoRA update to keep the model fresh without
catastrophic forgetting.

Intended to run as a cron job / scheduled task each night.

Usage:
    conda run -n xaiml python scripts/nightly_update.py \
        --base-trajectory pipeline_data/trajectories/hydrated.jsonl \
        --adapter-dir     pipeline_data/adapters

    # Override replay fraction (default 7 %):
    conda run -n xaiml python scripts/nightly_update.py \
        --base-trajectory pipeline_data/trajectories/hydrated.jsonl \
        --adapter-dir     pipeline_data/adapters \
        --replay-ratio    0.10
"""
import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main():
    parser = argparse.ArgumentParser(description="Phase 4: Nightly QLoRA adapter update")
    parser.add_argument("--base-trajectory", required=True,
                        help="Adobe hydrated JSONL (replay buffer source)")
    parser.add_argument("--adapter-dir",     default="pipeline_data/adapters",
                        help="Root directory for adapters")
    parser.add_argument("--replay-ratio",    type=float, default=None,
                        help="Fraction of old data to mix in (default 0.07 = 7%%)")
    parser.add_argument("--base-dir",        default="pipeline_data")
    args = parser.parse_args()

    from pipeline.config import PipelineConfig
    from pipeline.phase4_flywheel import NightlyUpdater

    cfg = PipelineConfig(base_dir=args.base_dir)
    cfg.adapter_dir = args.adapter_dir
    if args.replay_ratio is not None:
        cfg.replay_ratio = args.replay_ratio

    current_adapter = os.path.join(args.adapter_dir, "current")

    updater = NightlyUpdater(cfg)
    new_adapter = updater.run(
        base_trajectory_jsonl=args.base_trajectory,
        current_adapter_dir=current_adapter,
    )
    print(f"Nightly update complete. Active adapter → {new_adapter}")


if __name__ == "__main__":
    main()
