"""
Evaluate a (pretrained or fine-tuned) model on a set of sessions.
Outputs per-session metrics + an aggregate site report.

Usage:
    # Score a single session from stdin or file
    conda run -n xaiml python scripts/evaluate.py \
        --model   checkpoints/acme/finetune_best.pt \
        --sessions tester_sessions/acme_sessions.jsonl \
        --output  reports/acme_report.json

    # Score a single journey from a JSON file
    conda run -n xaiml python scripts/evaluate.py \
        --model   checkpoints/pretrain_best.pt \
        --journey journey.json
"""
import os
import json
import argparse

import torch

from model.transformer import JourneyTransformer
from model.metrics import per_step_surprisal, journey_metrics, site_report, \
    journey_embedding, MahalanobisDetector
from model.config import ModelConfig


def load_model(path: str, device: torch.device) -> JourneyTransformer:
    ckpt  = torch.load(path, map_location=device)
    cfg   = ModelConfig(**ckpt["config"])
    model = JourneyTransformer(cfg).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    return model


def main():
    parser = argparse.ArgumentParser(description="Evaluate JourneyTransformer")
    parser.add_argument("--model",     required=True,  help="Path to .pt checkpoint")
    parser.add_argument("--sessions",  default=None,   help="JSONL file of sessions")
    parser.add_argument("--journey",   default=None,   help="Single journey JSON file")
    parser.add_argument("--detector",  default=None,   help="Path to anomaly_detector.npz")
    parser.add_argument("--output",    default=None,   help="Save report to JSON file")
    parser.add_argument("--task",      default=None,   help="Filter sessions by task")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model  = load_model(args.model, device)
    print(f"Loaded model from {args.model}")

    detector = None
    if args.detector and os.path.exists(args.detector):
        detector = MahalanobisDetector()
        detector.load(args.detector)
        print(f"Loaded anomaly detector from {args.detector}")

    # ── Single journey mode ────────────────────────────────────────────────────
    if args.journey:
        with open(args.journey) as f:
            journey = json.load(f)
        steps = journey.get("steps", journey) if isinstance(journey, dict) else journey
        metrics = journey_metrics(model, steps, device=device)

        if detector:
            emb   = journey_embedding(model, steps, device=device)
            score = detector.score(emb)
            metrics["anomaly_score"] = round(score, 4)

        print(json.dumps(metrics, indent=2))
        if args.output:
            with open(args.output, "w") as f:
                json.dump(metrics, f, indent=2)
        return

    # ── Batch session mode ─────────────────────────────────────────────────────
    if not args.sessions:
        parser.error("Provide --sessions or --journey")

    with open(args.sessions) as f:
        sessions = [json.loads(l) for l in f if l.strip()]

    if args.task:
        sessions = [s for s in sessions if s.get("task") == args.task]
    print(f"Evaluating {len(sessions)} sessions…")

    # Per-session metrics
    per_session = []
    for sess in sessions:
        steps = sess.get("steps", [])
        if not steps:
            continue
        m = journey_metrics(model, steps, device=device)
        m["session_id"] = sess.get("session_id", "?")
        m["task"]       = sess.get("task", "unknown")
        m["completed"]  = sess.get("completed", None)

        if detector:
            emb   = journey_embedding(model, steps, device=device)
            m["anomaly_score"] = round(detector.score(emb), 4)

        per_session.append(m)

    # Aggregate report
    report = site_report(model, sessions, device=device)
    report["per_session"] = per_session

    print("\n── Site Report ───────────────────────────────────────")
    print(f"  Overall confusion: {report['site_confusion']}")
    print("\n  Per-task:")
    for task, tm in report["per_task"].items():
        print(f"    {task}: completion={tm['completion_rate']:.0%}  "
              f"confusion={tm['mean_confusion']}")
    print("\n  Top friction pages (highest mean surprisal):")
    for page, score in report["friction_pages"][:5]:
        print(f"    {page:20s}  surprisal={score:.3f}")

    if args.output:
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        with open(args.output, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nFull report saved → {args.output}")


if __name__ == "__main__":
    main()
