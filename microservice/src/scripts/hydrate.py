"""
Phase 1 CLI – Data Hydration

Converts Adobe RUM parquet → multi-modal trajectory JSONL
(SoM screenshots + DOM + inferred goals + action mappings).

Usage:
    conda run -n xaiml python scripts/hydrate.py \
        --parquet research/data/adobe.parquet \
        --output  pipeline_data/trajectories/hydrated.jsonl \
        --max-trajectories 5000 \
        --concurrency 4
"""
import argparse
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from pipeline.config import PipelineConfig
from pipeline.phase1_hydration import DataHydrator


def main():
    parser = argparse.ArgumentParser(description="Phase 1: Hydrate Adobe trajectories")
    parser.add_argument("--parquet",           required=True,
                        help=(
                            "Path to Adobe RUM data. Accepts: "
                            "a single .parquet file, "
                            "a directory (loads all *.parquet inside), "
                            "or a glob pattern (e.g. 'research/data/adobe-com-*.parquet')"
                        ))
    parser.add_argument("--output",            default=None,
                        help="Output JSONL path (default: pipeline_data/trajectories/hydrated.jsonl)")
    parser.add_argument("--max-trajectories",  type=int, default=5000,
                        help="Maximum number of trajectories to hydrate")
    parser.add_argument("--concurrency",       type=int, default=4,
                        help="Concurrent browser tabs for screenshot capture")
    parser.add_argument("--goal-model",        default=None,
                        help="LiteLLM model ID for goal inference (overrides env var)")
    parser.add_argument("--base-dir",          default="pipeline_data",
                        help="Root directory for pipeline data")
    args = parser.parse_args()

    cfg = PipelineConfig(base_dir=args.base_dir)
    if args.goal_model:
        cfg.goal_llm_model = args.goal_model

    # Update sub-dirs relative to base_dir
    import os
    cfg.screenshots_dir  = os.path.join(args.base_dir, "screenshots")
    cfg.doms_dir         = os.path.join(args.base_dir, "doms")
    cfg.trajectories_dir = os.path.join(args.base_dir, "trajectories")

    hydrator = DataHydrator(cfg)
    output   = asyncio.run(
        hydrator.run(
            parquet_path=args.parquet,
            output_path=args.output,
            max_trajectories=args.max_trajectories,
            concurrency=args.concurrency,
        )
    )
    print(f"Hydration complete → {output}")


if __name__ == "__main__":
    main()
