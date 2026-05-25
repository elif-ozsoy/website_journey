"""
Sync policy computation for the backend.

Derives per-page action distributions from human session events using the
existing SQLAlchemy session. Mirrors PolicyExtractor in microservice/src/policy/
but works with the backend's sync DB layer.

Note on goal-dependency: tracker_sessions has no task_id column, so the policy
is site-wide. task_id is accepted for future extensibility once the tester link
starts writing task context into sessions.
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session


# ── Policy computation ─────────────────────────────────────────────────────────

def build_ai_policy(site_id: str, db: Session, task_id: int | None = None) -> dict:
    """Build a behavioral policy from AI agent journey steps (analogous to build_policy for human events)."""
    from models.journey import Journey as JourneyModel

    q = db.query(JourneyModel).filter(
        JourneyModel.site_id == site_id,
        JourneyModel.is_agent == True,  # noqa: E712
        JourneyModel.source == "agent",
    )
    if task_id is not None:
        q = q.filter(JourneyModel.task_id == task_id)
    journeys = q.all()

    path_decisions: dict[str, list[dict]] = defaultdict(list)
    for journey in journeys:
        try:
            steps: list[dict] = json.loads(journey.steps)
        except Exception:
            continue
        for step in steps:
            url = step.get("url", "")
            path = urlparse(url).path or "/"
            action_type = step.get("action_type", "")
            details = step.get("action_details") or {}
            text = details.get("text") or details.get("value") or step.get("input_text") or ""
            href = details.get("url") or details.get("href") or ""
            selector = step.get("element_selector") or details.get("selector") or ""

            if not action_type or action_type in ("done", "finished", "task_done"):
                action: dict[str, Any] = {"type": "bounce", "text": "", "selector": "", "href": "", "position": {"x": 0, "y": 0}}
            else:
                action = {"type": action_type, "text": text, "selector": selector, "href": href, "position": {"x": 0, "y": 0}}

            path_decisions[path].append({
                "path": path,
                "time_on_page_ms": None,
                "scroll_depth": 0,
                "hover_targets": [],
                "action": action,
                "js_errors_count": 0,
                "perf": {"lcp_ms": None, "full_load_ms": None},
            })

    return {path: _aggregate(decs) for path, decs in path_decisions.items()}


def build_policy(site_id: str, db: Session, task_id: int | None = None) -> dict:
    rows = db.execute(
        text(
            """
            SELECT session_id, type, timestamp, path, data
            FROM events
            WHERE site_id = :site_id
            ORDER BY session_id, timestamp
            """
        ),
        {"site_id": site_id},
    ).fetchall()

    sessions: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        sessions[row.session_id].append(
            {
                "type": row.type,
                "timestamp": row.timestamp,
                "path": row.path or "/",
                "data": json.loads(row.data) if row.data else {},
            }
        )

    path_decisions: dict[str, list[dict]] = defaultdict(list)
    for session_id, events in sessions.items():
        for step in _extract_steps(events):
            decision = _extract_decision(step)
            decision["_session_id"] = session_id
            path_decisions[decision["path"]].append(decision)

    return {path: _aggregate(decs) for path, decs in path_decisions.items()}


def _extract_steps(events: list[dict]) -> list[dict]:
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
                "events": [event],
                "leave_data": None,
                "clicks": [],
                "hovers": [],
                "errors": [],
                "perf_data": {},
            }
        elif current is not None:
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


def _extract_decision(step: dict) -> dict:
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
        action = {"type": "bounce", "text": "", "selector": "", "href": "", "position": {"x": 0, "y": 0}}

    return {
        "path": step["path"],
        "time_on_page_ms": leave.get("time_on_page"),
        "scroll_depth": leave.get("scroll_depth", 0),
        "hover_targets": [{"text": h.get("text", ""), "selector": h.get("selector", "")} for h in hovers],
        "action": action,
        "js_errors_count": len(errors),
        "perf": {"lcp_ms": perf.get("lcp_ms"), "full_load_ms": perf.get("full_load_ms")},
    }


def _aggregate(decisions: list[dict]) -> dict:
    n = len(decisions)
    action_counts: dict[str, dict] = {}
    bounce_count = 0
    total_time, time_count, total_scroll = 0, 0, 0
    hover_counts: dict[str, int] = defaultdict(int)
    error_session_count = 0
    lcp_values: list[float] = []

    for d in decisions:
        action = d["action"]
        if action["type"] == "bounce":
            bounce_count += 1
        else:
            key = action.get("href") or action.get("text") or action.get("selector", "")
            if key not in action_counts:
                action_counts[key] = {"text": action.get("text", ""), "href": action.get("href", ""), "selector": action.get("selector", ""), "count": 0}
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

    return {
        "n_sessions": n,
        "action_distribution": sorted(
            [{"text": v["text"], "href": v["href"], "selector": v["selector"], "count": v["count"], "frequency": round(v["count"] / n, 4)} for v in action_counts.values()],
            key=lambda x: x["frequency"], reverse=True,
        ),
        "bounce_rate": round(bounce_count / n, 4),
        "avg_time_on_page_ms": round(total_time / time_count) if time_count > 0 else None,
        "avg_scroll_depth": round(total_scroll / n, 1),
        "common_hovers": sorted([{"text": t, "count": c, "frequency": round(c / n, 4)} for t, c in hover_counts.items()], key=lambda x: x["frequency"], reverse=True)[:5],
        "js_errors_rate": round(error_session_count / n, 4),
        "avg_lcp_ms": round(sum(lcp_values) / len(lcp_values)) if lcp_values else None,
    }


# ── Policy lookup & prompt injection ──────────────────────────────────────────

def get_policy_for_page(path: str, policy: dict) -> dict | None:
    if path in policy:
        return {**policy[path], "_match_type": "exact"}
    normalized = path.rstrip("/") or "/"
    if normalized in policy:
        return {**policy[normalized], "_match_type": "normalized"}
    base = urlparse(path).path or "/"
    if base in policy:
        return {**policy[base], "_match_type": "normalized"}
    base_norm = base.rstrip("/") or "/"
    if base_norm in policy:
        return {**policy[base_norm], "_match_type": "normalized"}
    return None


def generate_prompt_injection(path: str, policy: dict) -> str:
    pp = get_policy_for_page(path, policy)
    if pp is None:
        return f"<human_behavioral_policy>\nPage: {path} | No human data available.\n</human_behavioral_policy>"

    n = pp["n_sessions"]
    match_type = pp.get("_match_type", "exact").upper()
    lines = [
        "<human_behavioral_policy>",
        f"Page: {path} | Based on {n} human testers",
        "",
        "PREFERRED ACTIONS (act as the average human — pick the highest-frequency available action):",
    ]
    for idx, action in enumerate(pp.get("action_distribution", []), start=1):
        pct = round(action["frequency"] * 100)
        label = action.get("text") or action.get("href") or action.get("selector", "?")
        href_part = f"  →  {action['href']}" if action.get("href") else ""
        lines.append(f'  {idx}. Click "{label}"{href_part}   [{pct}% of users]')
    if pp.get("bounce_rate", 0) > 0:
        lines.append(f"  {len(pp.get('action_distribution', [])) + 1}. No action / bounced   [{round(pp['bounce_rate'] * 100)}% of users]")
    if pp.get("common_hovers"):
        lines += ["", "DELIBERATION SIGNALS:"]
        for h in pp["common_hovers"]:
            lines.append(f'  - "{h["text"]}" hovered by {round(h["frequency"] * 100)}% but rarely clicked')
    lines += ["", "BEHAVIORAL CONTEXT:"]
    if pp.get("avg_time_on_page_ms") is not None:
        lines.append(f"  - Avg. time before acting: {pp['avg_time_on_page_ms'] / 1000:.1f}s")
    scroll = pp.get("avg_scroll_depth", 0)
    lines.append(f"  - Avg. scroll depth: {scroll:.0f}%" + (" (acted without scrolling)" if scroll < 5 else ""))
    if pp.get("js_errors_rate", 0) > 0.5:
        lines.append(f"  - JS errors on {round(pp['js_errors_rate'] * 100)}% of sessions — hesitation may reflect tech issues")
    lines += ["", f"Match confidence: {match_type}", "</human_behavioral_policy>"]
    return "\n".join(lines)


def build_xai_trace_entry(step_num: int, step_data: dict, policy: dict) -> dict:
    step_url = step_data.get("url", "")
    step_path = urlparse(step_url).path if step_url else ""

    action_type = step_data.get("action_type", "")
    details = step_data.get("action_details") or {}
    text_val = details.get("text") or details.get("value") or ""
    url_val = details.get("url") or details.get("href") or ""
    if text_val:
        ai_action = f'{action_type}: "{text_val}"'
    elif url_val:
        ai_action = f"{action_type}: {url_val}"
    else:
        ai_action = action_type or "unknown"

    pp = get_policy_for_page(step_path, policy)
    if not pp:
        return {"step": step_num, "url": step_url, "path": step_path, "policy_injected": False, "policy_match_type": "none", "human_top_action": "", "human_top_action_frequency": 0.0, "ai_action": ai_action, "ai_followed_policy": False, "n_human_sessions": 0}

    dist = pp.get("action_distribution", [])
    human_top = dist[0].get("text") or dist[0].get("href", "") if dist else ""
    human_freq = dist[0].get("frequency", 0.0) if dist else 0.0
    ai_followed = bool(human_top and human_top.lower() in ai_action.lower())

    return {"step": step_num, "url": step_url, "path": step_path, "policy_injected": True, "policy_match_type": pp.get("_match_type", "exact"), "human_top_action": human_top, "human_top_action_frequency": human_freq, "ai_action": ai_action, "ai_followed_policy": ai_followed, "n_human_sessions": pp.get("n_sessions", 0)}
