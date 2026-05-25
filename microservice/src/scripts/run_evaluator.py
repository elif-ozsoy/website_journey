"""
Phase 3 CLI – Deployed Evaluator

Runs the fine-tuned Gemma-4 agent on a target website, collecting:
  - UX metrics (trajectory length, backtracking rate, per-step latency)
  - Accessibility violations (axe-core + VLM visual inspection)

Output: JSON report written to --output-dir / report_<timestamp>.json

Usage:
    conda run -n xaiml python scripts/run_evaluator.py \
        --adapter  pipeline_data/adapters/current \
        --goal     "Find Creative Cloud pricing" \
        --url      "https://www.adobe.com" \
        --output-dir pipeline_data/eval_reports

    # Evaluate multiple goals from a JSONL file:
    conda run -n xaiml python scripts/run_evaluator.py \
        --adapter  pipeline_data/adapters/current \
        --goals-file goals.jsonl \
        --output-dir pipeline_data/eval_reports
"""
import argparse
import asyncio
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


async def evaluate_one(agent, goal: str, url: str, output_dir: str):
    ts = int(time.time())
    session_dir = os.path.join(output_dir, f"session_{ts}")
    os.makedirs(session_dir, exist_ok=True)

    report = await agent.evaluate(goal=goal, start_url=url, output_dir=session_dir)
    report_path = os.path.join(session_dir, "report.json")
    with open(report_path, "w") as f:
        json.dump(report.to_dict(), f, indent=2)

    print(f"\n{'='*60}")
    print(f"Goal:              {goal}")
    print(f"Site:              {url}")
    print(f"Completed:         {report.completed}")
    print(f"Steps:             {report.total_steps}")
    print(f"Backtracks:        {report.backtrack_count} ({report.backtrack_rate:.1%})")
    print(f"Avg step latency:  {report.avg_ms_per_step:.0f} ms")
    print(f"Cognitive load:    {report.cognitive_load_score:.3f}")
    print(f"A11y violations:   {len(report.a11y_violations)}")
    print(f"Report saved:      {report_path}")
    return report


async def main_async(args):
    from pipeline.config import PipelineConfig
    from pipeline.phase3_evaluator import GemmaWebAgent

    cfg   = PipelineConfig(base_dir=args.base_dir)
    agent = GemmaWebAgent(
        adapter_dir=args.adapter,
        cfg=cfg,
        max_steps=args.max_steps,
    )

    os.makedirs(args.output_dir, exist_ok=True)

    if args.goals_file:
        with open(args.goals_file) as f:
            goals = [json.loads(l) for l in f if l.strip()]
        for entry in goals:
            await evaluate_one(agent, entry["goal"], entry["url"], args.output_dir)
    else:
        await evaluate_one(agent, args.goal, args.url, args.output_dir)


def main():
    parser = argparse.ArgumentParser(description="Phase 3: Run VLM web agent evaluator")
    parser.add_argument("--adapter",     required=True,
                        help="Path to LoRA adapter directory")
    parser.add_argument("--goal",        default=None,
                        help="Goal phrase for the agent")
    parser.add_argument("--url",         default=None,
                        help="Start URL for the agent")
    parser.add_argument("--goals-file",  default=None,
                        help="JSONL file with [{goal, url}, ...] entries")
    parser.add_argument("--max-steps",   type=int, default=30)
    parser.add_argument("--output-dir",  default="pipeline_data/eval_reports")
    parser.add_argument("--base-dir",    default="pipeline_data")
    args = parser.parse_args()

    if not args.goals_file and (not args.goal or not args.url):
        parser.error("Provide either --goals-file or both --goal and --url")

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
