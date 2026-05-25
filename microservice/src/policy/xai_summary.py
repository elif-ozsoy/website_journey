"""
Generates a Markdown XAI report from a completed trace file or trace list.

Usage:
    python microservice/src/policy/xai_summary.py xai_trace.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence


def generate_xai_report(
    xai_trace: list[dict],
    site_id: str = "",
    url: str = "",
) -> str:
    """Convert an XAI trace list into a Markdown report string."""
    header = f"## AI Journey XAI Report"
    if site_id:
        header += f" — site: {site_id}"
    if url:
        header += f"\n**URL:** {url}"

    lines = [header, ""]

    steps_with_policy = [s for s in xai_trace if s.get("policy_injected")]
    steps_followed = [s for s in steps_with_policy if s.get("ai_followed_policy")]

    for entry in xai_trace:
        step_num = entry.get("step", "?")
        path = entry.get("path") or entry.get("url", "?")
        ai_action = entry.get("ai_action", "unknown")
        policy_injected = entry.get("policy_injected", False)
        human_top = entry.get("human_top_action", "")
        human_freq = entry.get("human_top_action_frequency", 0.0)
        ai_followed = entry.get("ai_followed_policy", False)
        n_sessions = entry.get("n_human_sessions", 0)
        match_type = entry.get("policy_match_type", "none")

        lines.append(f"### Step {step_num}: {path}")

        if policy_injected:
            match_icon = "✅" if ai_followed else "❌"
            pct = round(human_freq * 100)
            lines.append(
                f'- **AI action**: {ai_action} '
                f'{match_icon} {"matches" if ai_followed else "deviates from"} '
                f'human majority ({pct}%)'
            )
            if human_top:
                lines.append(f'- **Human top action**: "{human_top}" [{pct}%]')
            lines.append(f"- **Human data**: {n_sessions} sessions (match: {match_type})")
        else:
            lines.append(f"- **AI action**: {ai_action}")
            lines.append("- ⚠️ No human data for this page (novel path)")

        lines.append("")

    # Summary
    total = len(xai_trace)
    n_with_policy = len(steps_with_policy)
    n_followed = len(steps_followed)
    novel = total - n_with_policy

    lines.append("### Summary")
    lines.append(f"- Steps with policy data: {n_with_policy}/{total}")
    if n_with_policy > 0:
        lines.append(
            f"- AI followed human majority: {n_followed}/{n_with_policy} "
            f"({round(n_followed / n_with_policy * 100)}%)"
        )
    if novel > 0:
        lines.append(f"- Steps with no human data: {novel} (novel path{'s' if novel > 1 else ''})")

    return "\n".join(lines)


def report_from_file(trace_path: str) -> str:
    """Load a trace JSON file and return a Markdown report."""
    with open(trace_path, encoding="utf-8") as f:
        payload = json.load(f)

    trace = payload.get("xai_trace", [])
    site_id = payload.get("site_id", "")
    url = payload.get("url", "")

    if not trace:
        return f"# XAI Report\n\nNo trace entries found in {trace_path}."

    return generate_xai_report(trace, site_id=site_id, url=url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate XAI Markdown report from trace file")
    parser.add_argument("trace_file", help="Path to the XAI trace JSON file")
    parser.add_argument("-o", "--output", help="Output .md file (default: stdout)")
    args = parser.parse_args()

    report = report_from_file(args.trace_file)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(report)
