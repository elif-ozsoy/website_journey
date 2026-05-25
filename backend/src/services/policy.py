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
from collections import Counter, defaultdict
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
    visit_decisions: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for journey in journeys:
        try:
            steps: list[dict] = json.loads(journey.steps)
        except Exception:
            continue
        path_visit_counts: dict[str, int] = defaultdict(int)
        for step in steps:
            url = step.get("url", "")
            path = urlparse(url).path or "/"
            path_visit_counts[path] += 1
            visit_num = path_visit_counts[path]
            action_type = step.get("action_type", "")
            details = step.get("action_details") or {}
            text = details.get("text") or details.get("value") or step.get("input_text") or ""
            href = details.get("url") or details.get("href") or ""
            selector = step.get("element_selector") or details.get("selector") or ""

            is_bounce = not action_type or action_type in ("done", "finished", "task_done")
            if is_bounce:
                action: dict[str, Any] = {"type": "bounce", "text": "", "selector": "", "href": "", "position": {"x": 0, "y": 0}}
            else:
                action = {"type": action_type, "text": text, "selector": selector, "href": href, "position": {"x": 0, "y": 0}}
            click_event = {"type": "click", "text": text, "href": href, "selector": selector}
            decision = {
                "path": path,
                "visit_number": visit_num,
                "time_on_page_ms": None,
                "scroll_depth": 0,
                "hover_targets": [],
                "all_clicks": [] if is_bounce else [{"text": text, "href": href, "selector": selector}],
                "event_sequence": [] if is_bounce else [click_event],
                "action": action,
                "js_errors_count": 0,
                "perf": {"lcp_ms": None, "full_load_ms": None},
            }
            path_decisions[path].append(decision)
            visit_decisions[path][visit_num].append(decision)

    result = {}
    for path, decs in path_decisions.items():
        agg = _aggregate(decs)
        agg["visit_sequence"] = [
            {"visit_number": vn, **_aggregate(visit_decisions[path][vn])}
            for vn in sorted(visit_decisions[path])
        ]
        result[path] = agg
    return result


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
    visit_decisions: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for session_id, events in sessions.items():
        for step in _extract_steps(events):
            decision = _extract_decision(step)
            decision["_session_id"] = session_id
            path = decision["path"]
            vn = decision.get("visit_number", 1)
            path_decisions[path].append(decision)
            visit_decisions[path][vn].append(decision)

    result = {}
    for path, decs in path_decisions.items():
        agg = _aggregate(decs)
        agg["visit_sequence"] = [
            {"visit_number": vn, **_aggregate(visit_decisions[path][vn])}
            for vn in sorted(visit_decisions[path])
        ]
        result[path] = agg
    return result


def _extract_steps(events: list[dict]) -> list[dict]:
    sorted_events = sorted(events, key=lambda e: e["timestamp"])
    steps: list[dict] = []
    current: dict | None = None
    visit_counts: dict[str, int] = defaultdict(int)

    for event in sorted_events:
        etype = event.get("type", "")
        edata = event.get("data") or {}
        if etype == "pageview":
            if current is not None:
                steps.append(current)
            path = event.get("path", "/")
            visit_counts[path] += 1
            current = {
                "path": path,
                "visit_number": visit_counts[path],
                "events": [event],
                "leave_data": None,
                "clicks": [],
                "hovers": [],
                "errors": [],
                "perf_data": {},
                "event_sequence": [],
            }
        elif current is not None:
            if etype == "click":
                current["clicks"].append(edata)
                current["event_sequence"].append({"type": "click", "text": edata.get("text", ""), "href": edata.get("href", ""), "selector": edata.get("selector", "")})
            elif etype == "hover_intent":
                current["hovers"].append(edata)
                current["event_sequence"].append({"type": "hover", "text": edata.get("text", ""), "href": edata.get("href", ""), "selector": edata.get("selector", "")})
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
        "visit_number": step.get("visit_number", 1),
        "time_on_page_ms": leave.get("time_on_page"),
        "scroll_depth": leave.get("scroll_depth", 0),
        "hover_targets": [{"text": h.get("text", ""), "selector": h.get("selector", "")} for h in hovers],
        "all_clicks": [{"text": c.get("text", ""), "href": c.get("href", ""), "selector": c.get("selector", "")} for c in clicks],
        "event_sequence": step.get("event_sequence", []),
        "action": action,
        "js_errors_count": len(errors),
        "perf": {"lcp_ms": perf.get("lcp_ms"), "full_load_ms": perf.get("full_load_ms")},
    }


def _action_label(event: dict) -> str | None:
    etype = event.get("type", "")
    text = (event.get("text") or "").strip()
    href = event.get("href", "")
    selector = event.get("selector", "")

    # Hovers don't represent navigation intent — skip them
    if etype == "hover":
        return None
    # Bare URL navigations (no text) are page-load artefacts — skip them
    if not text and href:
        return None

    label = text or selector or "?"
    if len(label) > 35:
        label = label[:32] + "…"
    return label


def _extract_sequence_patterns(sequences: list[list[str]], n_total: int) -> dict:
    """Find top complete sequences and the longest shared prefix among the top two."""
    if not sequences or n_total == 0:
        return {"top_sequences": [], "common_prefix": None}

    valid = [tuple(s) for s in sequences if s]
    if not valid:
        return {"top_sequences": [], "common_prefix": None}

    seq_counts = Counter(valid)
    top_sequences = [
        {"sequence": list(seq), "count": cnt, "frequency": round(cnt / n_total, 4)}
        for seq, cnt in seq_counts.most_common(5)
    ]

    common_prefix: dict | None = None
    if len(seq_counts) >= 2:
        top_two = [seq for seq, _ in seq_counts.most_common(2)]
        prefix: list[str] = []
        for a, b in zip(top_two[0], top_two[1]):
            if a == b:
                prefix.append(a)
            else:
                break
        if prefix:
            pt = tuple(prefix)
            prefix_count = sum(cnt for seq, cnt in seq_counts.items() if seq[: len(pt)] == pt)
            if prefix_count > seq_counts.most_common(1)[0][1]:
                common_prefix = {
                    "sequence": prefix,
                    "count": prefix_count,
                    "frequency": round(prefix_count / n_total, 4),
                }

    return {"top_sequences": top_sequences, "common_prefix": common_prefix}


def _aggregate(decisions: list[dict]) -> dict:
    n = len(decisions)
    action_counts: dict[str, dict] = {}   # first-click only, kept for XAI trace
    all_click_counts: dict[str, dict] = {}  # every click on the page
    bounce_count = 0
    total_time, time_count, total_scroll = 0, 0, 0
    hover_counts: dict[str, int] = defaultdict(int)
    error_session_count = 0
    lcp_values: list[float] = []
    raw_sequences: list[list[str]] = []

    for d in decisions:
        action = d["action"]
        if action["type"] == "bounce":
            bounce_count += 1
        else:
            key = action.get("href") or action.get("text") or action.get("selector", "")
            if key not in action_counts:
                action_counts[key] = {"text": action.get("text", ""), "href": action.get("href", ""), "selector": action.get("selector", ""), "count": 0}
            action_counts[key]["count"] += 1

        for c in d.get("all_clicks", []):
            key = c.get("href") or c.get("text") or c.get("selector", "")
            if not key:
                continue
            if key not in all_click_counts:
                all_click_counts[key] = {"text": c.get("text", ""), "href": c.get("href", ""), "selector": c.get("selector", ""), "count": 0}
            all_click_counts[key]["count"] += 1

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

        seq = d.get("event_sequence", [])
        if seq:
            labels = [lbl for lbl in (_action_label(e) for e in seq) if lbl is not None]
            if labels:
                raw_sequences.append(labels)

    return {
        "n_sessions": n,
        "action_distribution": sorted(
            [{"text": v["text"], "href": v["href"], "selector": v["selector"], "count": v["count"], "frequency": round(v["count"] / n, 4)} for v in action_counts.values()],
            key=lambda x: x["frequency"], reverse=True,
        ),
        "click_distribution": sorted(
            [{"text": v["text"], "href": v["href"], "selector": v["selector"], "count": v["count"], "frequency": round(v["count"] / n, 4)} for v in all_click_counts.values()],
            key=lambda x: x["frequency"], reverse=True,
        ),
        "bounce_rate": round(bounce_count / n, 4),
        "avg_time_on_page_ms": round(total_time / time_count) if time_count > 0 else None,
        "avg_scroll_depth": round(total_scroll / n, 1),
        "hover_distribution": sorted([{"text": t, "count": c, "frequency": round(c / n, 4)} for t, c in hover_counts.items()], key=lambda x: x["frequency"], reverse=True)[:10],
        "js_errors_rate": round(error_session_count / n, 4),
        "avg_lcp_ms": round(sum(lcp_values) / len(lcp_values)) if lcp_values else None,
        "sequence_patterns": _extract_sequence_patterns(raw_sequences, n),
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


def _ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def _render_interactions(lines: list[str], pp: dict, indent: str = "  ") -> None:
    seq_pat = pp.get("sequence_patterns") or {}
    top_seqs = seq_pat.get("top_sequences", [])
    common_prefix = seq_pat.get("common_prefix")

    if top_seqs:
        for sp in top_seqs[:4]:
            seq_str = " → ".join(sp["sequence"])
            lines.append(f"{indent}{sp['count']} user(s): {seq_str}")
        if common_prefix:
            pct = round(common_prefix["frequency"] * 100)
            prefix_str = " → ".join(common_prefix["sequence"])
            lines.append(f"{indent}↳ Always begin with: {prefix_str}  [{pct}% of users — then follow whichever click above]")
    else:
        # Fallback: flat click / hover lists when no sequence data is available
        click_dist = pp.get("click_distribution") or pp.get("action_distribution", [])
        bounce = pp.get("bounce_rate", 0)
        if click_dist:
            parts = []
            for c in click_dist:
                pct = round(c["frequency"] * 100)
                label = c.get("text") or c.get("href") or c.get("selector", "?")
                href_part = f" → {c['href']}" if c.get("href") else ""
                parts.append(f'"{label}"{href_part} [{pct}%]')
            if bounce > 0:
                parts.append(f"no action [{round(bounce * 100)}%]")
            lines.append(f"{indent}Clicked: " + ", ".join(parts))
        else:
            lines.append(f"{indent}Clicked: nothing — bounced [{round(bounce * 100)}%]")
        hovers = pp.get("hover_distribution", [])
        if hovers:
            parts = [f'"{h["text"]}" [{round(h["frequency"] * 100)}%]' for h in hovers]
            lines.append(f"{indent}Hovered: " + ", ".join(parts))


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
    ]

    visit_seq = pp.get("visit_sequence", [])
    if len(visit_seq) > 1:
        lines.append("USER INTERACTIONS per visit — follow this order each time you arrive at this URL:")
        for vs in visit_seq:
            vn = vs["visit_number"]
            n_vs = vs["n_sessions"]
            lines.append(f"")
            lines.append(f"  {_ordinal(vn)} visit ({n_vs} users):")
            _render_interactions(lines, vs, indent="    ")
    else:
        lines.append("USER INTERACTIONS:")
        _render_interactions(lines, pp, indent="  ")

    scroll = pp.get("avg_scroll_depth", 0)
    lines += ["", "BEHAVIORAL CONTEXT:"]
    lines.append(f"  - Avg. scroll depth: {scroll:.0f}%" + (" (acted without scrolling)" if scroll < 5 else ""))
    if pp.get("js_errors_rate", 0) > 0.5:
        lines.append(f"  - JS errors on {round(pp['js_errors_rate'] * 100)}% of sessions — hesitation may reflect tech issues")
    lines += ["", f"Match confidence: {match_type}", "</human_behavioral_policy>"]
    return "\n".join(lines)


def generate_full_policy_prompt(policy: dict) -> str:
    """Generate a comprehensive policy prompt covering ALL pages for permanent agent context."""
    if not policy:
        return ""

    lines = [
        "<human_behavioral_policy>",
        "COMPLETE SITE FLOW — match these human patterns for every page you visit:",
        "",
    ]

    for path in sorted(policy.keys()):
        pp = policy[path]
        n = pp["n_sessions"]
        lines.append(f"── {path}  ({n} users) ──")

        seq_pat = pp.get("sequence_patterns") or {}
        top_seqs = seq_pat.get("top_sequences", [])

        visit_seq = pp.get("visit_sequence", [])
        if top_seqs:
            top = top_seqs[0]
            pct = round(top["frequency"] * 100)
            lines.append(f"  Main flow [{pct}%]: " + " → ".join(top["sequence"]))
            for sp in top_seqs[1:3]:
                pct2 = round(sp["frequency"] * 100)
                lines.append(f"  Alt [{pct2}%]:  " + " → ".join(sp["sequence"]))
        elif len(visit_seq) > 1:
            for vs in visit_seq:
                vn = vs["visit_number"]
                vs_seq = vs.get("sequence_patterns", {}).get("top_sequences", [])
                if vs_seq:
                    pct = round(vs_seq[0]["frequency"] * 100)
                    lines.append(f"  Visit {vn} [{pct}%]: " + " → ".join(vs_seq[0]["sequence"]))
                else:
                    cd = vs.get("click_distribution") or vs.get("action_distribution", [])
                    if cd:
                        parts = [f'"{c.get("text") or c.get("href") or "?"}" [{round(c["frequency"] * 100)}%]' for c in cd[:3]]
                        lines.append(f"  Visit {vn}: " + ", ".join(parts))
        else:
            click_dist = pp.get("click_distribution") or pp.get("action_distribution", [])
            bounce = pp.get("bounce_rate", 0)
            if click_dist:
                parts = [f'"{c.get("text") or c.get("href") or c.get("selector") or "?"}" [{round(c["frequency"] * 100)}%]' for c in click_dist[:4]]
                if bounce > 0.2:
                    parts.append(f"no action [{round(bounce * 100)}%]")
                lines.append("  Actions: " + ", ".join(parts))
            else:
                lines.append(f"  Bounce [{round(bounce * 100)}%] — no interactions recorded")

        lines.append("")

    lines += [
        "Apply the matching page pattern every time you navigate to a new URL.",
        "Prioritise human journey adherence over task efficiency.",
        "</human_behavioral_policy>",
    ]
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
