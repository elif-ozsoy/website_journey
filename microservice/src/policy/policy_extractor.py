"""
Extracts human behavioral policies from raw session events.

Usage (CLI):
    python microservice/src/policy/policy_extractor.py --site-id <id>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse


class PolicyExtractor:
    """Converts raw DB events into per-page action probability distributions."""

    # ── Step splitting ─────────────────────────────────────────────────────────

    def extract_steps(self, events: list[dict]) -> list[dict]:
        """Split a sorted event list into page-view steps.

        Each step groups every event between two consecutive pageview events.
        """
        sorted_events = sorted(events, key=lambda e: e["timestamp"])
        steps: list[dict] = []
        current: dict | None = None

        for event in sorted_events:
            etype = event.get("type", "")
            edata = event.get("data") or {}

            if etype == "pageview":
                if current is not None:
                    steps.append(current)
                current = {
                    "path": event.get("path", "/"),
                    "pageview_data": edata,
                    "events": [event],
                    "leave_data": None,
                    "clicks": [],
                    "hovers": [],
                    "errors": [],
                    "perf_data": {},
                }
            elif current is not None:
                current["events"].append(event)
                if etype == "click":
                    current["clicks"].append(edata)
                elif etype == "hover_intent":
                    current["hovers"].append(edata)
                elif etype == "js_error":
                    current["errors"].append(edata)
                elif etype == "page_leave":
                    current["leave_data"] = edata
                elif etype in ("performance", "lcp"):
                    current["perf_data"].update(edata)

        if current is not None:
            steps.append(current)

        return steps

    # ── Per-step decision ──────────────────────────────────────────────────────

    def extract_decision(self, step: dict) -> dict:
        """Derive the single most important decision from a page-view step."""
        leave = step.get("leave_data") or {}
        perf = step.get("perf_data") or {}
        clicks = step.get("clicks", [])
        hovers = step.get("hovers", [])
        errors = step.get("errors", [])

        if clicks:
            first = clicks[0]
            action: dict[str, Any] = {
                "type": "click",
                "text": first.get("text", ""),
                "selector": first.get("selector", ""),
                "href": first.get("href", ""),
                "position": {"x": first.get("x", 0), "y": first.get("y", 0)},
            }
        else:
            action = {
                "type": "bounce",
                "text": "",
                "selector": "",
                "href": "",
                "position": {"x": 0, "y": 0},
            }

        return {
            "path": step["path"],
            "time_on_page_ms": leave.get("time_on_page"),
            "scroll_depth": leave.get("scroll_depth", 0),
            "hover_targets": [
                {"text": h.get("text", ""), "selector": h.get("selector", "")}
                for h in hovers
            ],
            "action": action,
            "js_errors_count": len(errors),
            "perf": {
                "lcp_ms": perf.get("lcp_ms"),
                "full_load_ms": perf.get("full_load_ms"),
            },
        }

    # ── Policy aggregation ─────────────────────────────────────────────────────

    async def build_policy(self, site_id: str, db_conn: Any) -> dict:
        """Fetch all events for a site and compute per-path action distributions."""
        rows = await db_conn.fetch(
            """
            SELECT session_id, type, timestamp, path, data
            FROM events
            WHERE site_id = $1
            ORDER BY session_id, timestamp
            """,
            site_id,
        )

        sessions: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            sessions[row["session_id"]].append(dict(row))

        path_decisions: dict[str, list[dict]] = defaultdict(list)
        for session_id, events in sessions.items():
            for step in self.extract_steps(events):
                decision = self.extract_decision(step)
                decision["_session_id"] = session_id
                path_decisions[decision["path"]].append(decision)

        return {path: self._aggregate(decisions) for path, decisions in path_decisions.items()}

    def _aggregate(self, decisions: list[dict]) -> dict:
        n = len(decisions)
        action_counts: dict[str, dict] = {}
        bounce_count = 0
        total_time = 0
        time_count = 0
        total_scroll = 0
        hover_counts: dict[str, int] = defaultdict(int)
        error_session_count = 0
        lcp_values: list[int] = []

        for d in decisions:
            action = d["action"]
            if action["type"] == "bounce":
                bounce_count += 1
            else:
                # Key by href first, fall back to text then selector
                key = action.get("href") or action.get("text") or action.get("selector", "")
                if key not in action_counts:
                    action_counts[key] = {
                        "text": action.get("text", ""),
                        "href": action.get("href", ""),
                        "selector": action.get("selector", ""),
                        "count": 0,
                    }
                action_counts[key]["count"] += 1

            if d.get("time_on_page_ms") is not None:
                total_time += d["time_on_page_ms"]
                time_count += 1

            total_scroll += d.get("scroll_depth", 0)

            if d.get("js_errors_count", 0) > 0:
                error_session_count += 1

            for h in d.get("hover_targets", []):
                if h.get("text"):
                    hover_counts[h["text"]] += 1

            lcp = (d.get("perf") or {}).get("lcp_ms")
            if lcp is not None:
                lcp_values.append(lcp)

        action_distribution = sorted(
            [
                {
                    "text": v["text"],
                    "href": v["href"],
                    "selector": v["selector"],
                    "count": v["count"],
                    "frequency": round(v["count"] / n, 4),
                }
                for v in action_counts.values()
            ],
            key=lambda x: x["frequency"],
            reverse=True,
        )

        common_hovers = sorted(
            [
                {"text": text, "count": count, "frequency": round(count / n, 4)}
                for text, count in hover_counts.items()
            ],
            key=lambda x: x["frequency"],
            reverse=True,
        )[:5]

        return {
            "n_sessions": n,
            "action_distribution": action_distribution,
            "bounce_rate": round(bounce_count / n, 4),
            "avg_time_on_page_ms": round(total_time / time_count) if time_count > 0 else None,
            "avg_scroll_depth": round(total_scroll / n, 1),
            "common_hovers": common_hovers,
            "js_errors_rate": round(error_session_count / n, 4),
            "avg_lcp_ms": round(sum(lcp_values) / len(lcp_values)) if lcp_values else None,
        }

    # ── Policy lookup ──────────────────────────────────────────────────────────

    def get_policy_for_page(self, path: str, policy: dict) -> dict | None:
        """Return the page policy with a '_match_type' annotation, or None."""
        if path in policy:
            return {**policy[path], "_match_type": "exact"}

        # Strip trailing slash (but keep bare "/")
        normalized = path.rstrip("/") or "/"
        if normalized in policy:
            return {**policy[normalized], "_match_type": "normalized"}

        # Strip query params
        base = urlparse(path).path or "/"
        if base in policy:
            return {**policy[base], "_match_type": "normalized"}

        base_normalized = base.rstrip("/") or "/"
        if base_normalized in policy:
            return {**policy[base_normalized], "_match_type": "normalized"}

        return None

    # ── Prompt injection ───────────────────────────────────────────────────────

    def generate_prompt_injection(self, path: str, policy: dict) -> str:
        """Format a <human_behavioral_policy> XML block for LLM system prompt injection."""
        page_policy = self.get_policy_for_page(path, policy)

        if page_policy is None:
            return (
                f"<human_behavioral_policy>\n"
                f"Page: {path} | No human data available for this page.\n"
                f"</human_behavioral_policy>"
            )

        n = page_policy["n_sessions"]
        match_type = page_policy.get("_match_type", "exact").upper()
        action_dist = page_policy.get("action_distribution", [])
        bounce_rate = page_policy.get("bounce_rate", 0.0)
        avg_time_ms = page_policy.get("avg_time_on_page_ms")
        avg_scroll = page_policy.get("avg_scroll_depth", 0)
        hovers = page_policy.get("common_hovers", [])
        js_err_rate = page_policy.get("js_errors_rate", 0.0)

        lines = [
            "<human_behavioral_policy>",
            f"Page: {path} | Based on {n} human testers",
            "",
            "PREFERRED ACTIONS (act as the average human — pick the highest-frequency",
            "available action):",
        ]

        for idx, action in enumerate(action_dist, start=1):
            pct = round(action["frequency"] * 100)
            label = action.get("text") or action.get("href") or action.get("selector", "?")
            href = action.get("href", "")
            href_part = f"  →  {href}" if href else ""
            lines.append(f'  {idx}. Click "{label}"{href_part}   [{pct}% of users]')

        if bounce_rate > 0:
            pct = round(bounce_rate * 100)
            next_idx = len(action_dist) + 1
            lines.append(
                f"  {next_idx}. No action / bounced"
                f"                                [{pct}% of users]"
            )

        if hovers:
            lines.append("")
            lines.append("DELIBERATION SIGNALS (users considered these before deciding):")
            for h in hovers:
                pct = round(h["frequency"] * 100)
                lines.append(f'  - "{h["text"]}" was hovered by {pct}% but rarely clicked')

        lines.append("")
        lines.append("BEHAVIORAL CONTEXT:")

        if avg_time_ms is not None:
            lines.append(f"  - Avg. time before acting: {avg_time_ms / 1000:.1f}s")

        scroll_suffix = " (users acted without scrolling)" if avg_scroll < 5 else ""
        lines.append(f"  - Avg. scroll depth: {avg_scroll:.0f}%{scroll_suffix}")

        if js_err_rate > 0.5:
            pct = round(js_err_rate * 100)
            lines.append(
                f"  - JS errors detected on this page ({pct}% of sessions) — "
                f"some hesitation may reflect technical issues, not UX confusion"
            )

        lines.append("")
        lines.append(f"Match confidence: {match_type}")
        lines.append("</human_behavioral_policy>")

        return "\n".join(lines)


# ── CLI entry point ────────────────────────────────────────────────────────────

async def _cli_main(site_id: str) -> None:
    import asyncpg  # type: ignore

    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/postgres",
    )
    conn = await asyncpg.connect(db_url)
    try:
        extractor = PolicyExtractor()
        policy = await extractor.build_policy(site_id, conn)
        print(json.dumps(policy, indent=2, ensure_ascii=False))
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute behavioral policy for a site")
    parser.add_argument("--site-id", required=True, help="Site ID to extract policy for")
    args = parser.parse_args()
    asyncio.run(_cli_main(args.site_id))
