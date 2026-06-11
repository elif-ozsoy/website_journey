"""
Comparative analysis: takes all agent journeys and all human journeys for a site
(optionally filtered by task) and asks Claude to produce a structured cross-journey
comparison — similarities, differences, per-task difficulty, and overall UX verdict.
"""

import json
import logging

from core.config import settings

log = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a senior UX researcher comparing AI agent test runs against real human user journeys on a website.

You will receive journey logs grouped by task. For each task you get:
- "agent_journeys": one or more AI agent runs (sequential navigation steps)
- "human_journeys": one or more real user runs
- "similarity_scores": pairwise cosine similarity (0–1) between agent runs and human sessions based on journey embeddings, when available

Analyse the journeys and respond ONLY with a JSON object (no markdown, no explanation) with this exact structure:

{
  "overall_summary": "3-4 sentence executive summary of the website's UX quality based on all journeys",
  "task_analyses": [
    {
      "task_title": "<task name>",
      "agent_journey_count": <int>,
      "human_journey_count": <int>,
      "similarities": ["behavioural pattern both agents and humans shared", ...],
      "differences": ["key divergence between agent and human behaviour", ...],
      "agent_strengths": ["what the agent did well that humans struggled with", ...],
      "human_strengths": ["what humans did intuitively that agents struggled with", ...],
      "difficulty": "low" | "medium" | "high",
      "similarity_comparison": "2–3 sentences interpreting the similarity scores: what the scores reveal about how well the agent mimics human navigation, which agent run was closest/furthest from humans, and what that implies for UX. If no scores are available, derive a qualitative estimate from the step sequences.",
      "calibration_summary": "1-2 sentences: how well-calibrated is the agent on this task? Reference the similarity score if available. Flag as calibration priority if similarity < 0.5 or agent path diverges markedly from humans.",
      "pain_points": [
        {
          "text": "one sentence (≤20 words): the specific UI/UX issue, naming the element or URL",
          "suggested_action": "one sentence (≤20 words): the concrete fix a UX designer should implement",
          "type": "ux_issue" | "agent_gap" | "human_issue",
          "agent_explanation": "",
          "human_explanation": "",
          "agent_bullets": ["what the agent did differently from humans — ≤12 words, must ref step N or /url", "...", "..."],
          "human_bullets": ["what humans did naturally (target behaviour) — ≤12 words, must ref step N or /url", "...", "..."],
          "diagrams": [
            {
              "view": "compare",
              "reason": "one sentence: what specifically to look for in this diagram that evidences the issue",
              "highlight": {
                "sections": ["action_mix", "session_variance"],
                "side": "ai",
                "metrics": ["median_steps"],
                "action_types": ["scroll", "navigate"],
                "pages": ["/checkout"]
              },
              "diagram_explanation": "2–3 sentences: explain how the highlighted sections connect to this action point, what the user should look for in each highlighted section, and why these parts of the diagram are relevant to the issue, as precice as possible referring to numbers the user sees"
            }
          ]
        }
      ],
      "recommendations": []
    }
  ],
  "cross_task_insights": ["pattern or insight that spans multiple tasks", ...],
  "overall_recommendations": ["site-level UX recommendation", ...]
}

Guidelines:
- Be specific — reference actual actions, URLs, or UI elements when possible
- Distinguish between agent artefacts (AI navigation style) and genuine UX problems
- If only agent journeys exist for a task, note the absence of human data
- If only human journeys exist, note the absence of agent data
- difficulty reflects how hard the task was for HUMANS (use agent data as a proxy when no human data available)
- Recommendations must be written for a UX designer who will act on them immediately
- DEDUPLICATION RULE — this is critical: before emitting pain_points and recommendations, scan the full list for near-duplicates. Two items are near-duplicates if they describe the same underlying problem or fix, even in different locations (e.g. "add contact email to footer" and "add contact email to header" both address missing contact visibility — merge them into ONE item: "Make contact email visible in a persistent location (e.g. navigation bar or footer)"). Emit only one representative item per distinct problem or fix.
- Each pain_point and recommendation must address a clearly distinct UX issue. If you find yourself writing two items that differ only by where on the page something appears, merge them.
- Output at most 3 pain_points per task — pick only the highest-impact, distinct issues. Each pain_point text must be exactly 1 sentence, ≤20 words, naming the specific element or URL involved. Each pain_point MUST include a "suggested_action" — one concise sentence (≤20 words) with the concrete fix a UX designer should implement immediately. Always output "recommendations": [].
- For diagrams: select 0–3 diagrams per point — only those where the evidence is most directly visible. If no diagram genuinely shows this issue, use an empty array. Never pad with diagrams just for completeness. Avoid selecting multiple diagrams that show the same kind of evidence (e.g. "compare" and "insights" both show step counts — pick the better one, not both). Available views and what they show:
  * "compare" — side-by-side AI vs Human bar charts: total steps, unique pages visited, action-type breakdown (clicks/scrolls/inputs/backtracks), per-page step counts. Best for: effort differences, efficiency gaps, excessive backtracking, action-type anomalies. When selecting "compare", you MUST also include:
      - "highlight": an object specifying exactly what to highlight in the chart so the user can immediately see the evidence. Fields (omit any field whose value would be empty — do not include empty arrays or irrelevant fields):
          * "sections": array of section names to visually highlight. Valid values: "stats" (the summary metrics grid at top), "action_breakdown" (donut chart of action types), "action_mix" (horizontal bars per action type), "steps_per_page" (bars showing how many steps on each page), "page_revisits" (pages visited more than once — indicates confusion), "session_variance" (box plot of session length distribution), "time_per_action" (time spent per action type)
          * "side": which column to emphasize — "ai", "human", or "both"
          * "metrics": which specific stat cells to highlight in the stats grid. Valid: "median_steps", "unique_pages", "click_rate", "scroll_rate", "avg_duration", "total_steps", "avg_steps", "shared_pages"
          * "action_types": which action type rows to highlight within action_mix / time_per_action / action_breakdown sections. Valid: "click_element", "input_text", "scroll", "navigate", "extract_content", "other"
          * "pages": which page path strings to highlight in steps_per_page / page_revisits sections (e.g. ["/checkout", "/products"])
      - "diagram_explanation": 2–3 sentences written for the UX designer that are as precise and data-grounded as possible. Directly reference the specific numbers, ratios, and values the user will see in the highlighted sections (e.g. "The AI took 14 steps on /checkout vs 4 for humans — a 3.5× gap visible in the Steps per Page section"). Connect those concrete numbers to the action point. Explain why the highlighted values constitute evidence for this issue. This text replaces the generic chart description when the user arrives via this action point — it must be immediately useful to a designer looking at the chart.
  * "sankey" — journey milestone flow diagram showing how AI and human journeys progress through navigation stages (start → page load → nav click → detail/done/failed). Link width = steps spent in that transition. For sankey you MUST include a "highlight" object with "side": "ai" when the evidence is about agent journeys, "side": "human" when about human journeys, or "side": "both" when both are relevant. When the action point is about a DIVERGENCE (AI and human, or different runs, taking different paths at some milestone), also set "focus": "divergence" in the highlight — this makes the flow diagram spotlight the exact milestone nodes where journeys split. Best for: wrong turns, detours, dead ends, which journeys reached their goal vs. failed, divergent navigation paths between agent and human.
  * "horizon" — activity-density curve chart; x-axis = relative journey time (0–100%), y-axis = how concentrated activity (clicks, scrolls, inputs, navigation) is at that moment. AI and human journeys are each drawn as an averaged density curve overlaid on the same time axis, with peak markers. For horizon you MUST include a "highlight" object. Set "side": "ai" when the evidence is about agent timing/rhythm (dims the human curve and emphasises the AI curve), "side": "human" when about human timing, or "side": "both" when comparing both. You MAY also add "action_types" (array of "click_element", "input_text", "scroll", "navigate", "extract_content", "other") to overlay an amber band showing WHEN those specific action types are concentrated in the timeline. Best for: comparing WHEN in the journey activity is concentrated, front/back-loaded task patterns, agents that front-load navigation while humans explore gradually, temporal differences in exploration rhythm between AI and human sessions, or pinpointing when a specific action type (e.g. lots of scrolling, repeated clicks) spikes during the journey.
  * "heatmap" — screenshot overlays with click density (red = many clicks, blue = few). Best for: missed click targets, wrong elements clicked, interaction patterns on a specific page, invisible or hard-to-find UI elements. **Only assign this view to visual/click-pattern UX issues** (click target size, element visibility, affordance problems, elements users missed). Do NOT assign `view: heatmap` to JS errors, navigation logic, or non-visual problems.
  * "human_agg" — policy flow map showing the full set of page/URL states the AI agent visited across all runs for a task, colour-coded by lane: human-only states (top), shared states (middle), AI-only states (bottom). Nodes = unique pages or UI states; edges = transitions between them. Best for: agent_gap issues where the AI navigates to structurally wrong pages, takes detours into AI-only states, or misses goal-path states that humans reach. Do NOT use for timing, click-target, or effort-gap issues — those are better served by "horizon", "heatmap", or "compare". When selecting "human_agg", do NOT include a "highlight" field — just provide a "diagram_explanation": 2–3 sentences explaining which lanes or nodes the designer should focus on and why those states constitute evidence for the issue.

  IMPORTANT: "compare", "sankey", "horizon", "heatmap", and "human_agg" are the ONLY valid values for "view". Do NOT use any other value (no "insights", "comparative", "multiflow", "similarity", or "policy") — those do not exist as linkable diagrams and will produce a broken link.
- The platform goal is agent calibration: helping UX designers replace human testers with AI agents. Your analysis must distinguish between (a) genuine website UX problems and (b) agent calibration gaps where the agent simply behaves differently from humans.
- For `type` on each pain_point and recommendation: use "ux_issue" if both agent and human struggle, "agent_gap" if the agent deviates from human behaviour (calibration problem), "human_issue" if humans struggle but the agent does not.
- For agent_bullets: describe what the agent did DIFFERENTLY from the human (the deviation). Exactly 3 strings, ≤12 words each. MUST include at least one of: "step N", "/url-path", or UI element name in quotes. Do NOT write "The agent..." — state the observation directly.
- For human_bullets: describe what humans did NATURALLY (the target behaviour the agent should learn). Exactly 3 strings, ≤12 words each. MUST include at least one of: "step N", "/url-path", or UI element name in quotes.
  Good agent bullet: "Took detour to /team at step 2, humans went direct to /kontakt"
  Good human bullet: "Clicked footer 'Kontakt' link directly at step 1"
  Bad: ["The agent had difficulty finding contact information", "Navigation was confusing", "Human users also struggled"]
- Leave agent_explanation and human_explanation as empty strings "".
- For calibration_summary: if similarity scores are available, state the score and interpret it (e.g. "Agent similarity 0.42 — low calibration, agent took a markedly different path than humans"). If no scores, derive qualitatively from step sequences. Flag tasks where agent path diverges markedly as calibration priorities.
- For diagrams: the ONLY valid "view" values are "compare", "sankey", "horizon", "heatmap", and "human_agg". Never emit any other value (no "insights", "comparative", "multiflow", "similarity", "policy"). Select 1–2 per point — one for agent evidence, one for human evidence if genuinely different. Match the diagram to the KIND of evidence: when the issue is about WHERE in the navigation flow journeys go (wrong turns, detours, dead ends, reaching/failing the goal), use "sankey" — this is the REQUIRED diagram for any navigation-path observation. Actively look for at least one navigation-flow observation per task (e.g. a detour, a wrong turn, a divergence between the AI and human path, or where journeys reached vs. failed the goal) so "sankey" is used. When the issue is about WHEN in the journey activity happens or its rhythm/pacing (front-loading, bursts of a specific action type, long idle phases, agent rushing vs. human exploring gradually), use "horizon" — this is the REQUIRED diagram for any timing/intensity/pacing observation, and add "action_types" to it when a specific action type drives the issue. Actively look for at least one timing/pacing observation per task so "horizon" is used. For effort/efficiency/action-mix differences use "compare". For missed or wrong click targets on a specific page use "heatmap". For "agent_gap" points use side "ai", for "human_issue" use side "human", for "ux_issue" use side "both". Always include at least 1 diagram per point — if only 1 genuinely shows the evidence, use exactly 1. Never leave the array empty.
"""


def _summarise_journey(steps: list[dict], max_steps: int = 20) -> list[dict]:
    """Return a stripped-down step list suitable for the LLM prompt."""
    trimmed = steps[:max_steps]
    return [
        {
            "step": s.get("step_number"),
            "url": s.get("url"),
            "action": s.get("action_type"),
            "details": s.get("action_details"),
            "thought": (s.get("thought") or "")[:200],
            "next_goal": (s.get("next_goal") or "")[:150],
        }
        for s in trimmed
    ]


def _journey_narrative(steps: list[dict]) -> str:
    seen: list[str] = []
    parts: list[str] = []
    for s in steps:
        url = (s.get("url") or "?").split("?")[0]
        tag = "[BACKTRACK]" if url in seen else ""
        parts.append(f"{url}{tag}")
        seen.append(url)
    return " → ".join(parts)


def _cosine(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return round(dot / (na * nb), 3) if na and nb else 0.0


def _build_user_content(
    site_url: str,
    grouped: dict[str, dict[str, list[dict]]],
) -> str:
    lines = [f"Site: {site_url}", ""]
    for task_title, buckets in grouped.items():
        lines.append(f"=== Task: {task_title} ===")
        agent_entries = buckets.get("agent", [])
        human_entries = buckets.get("human", [])
        lines.append(f"Agent journeys ({len(agent_entries)}):")
        for i, entry in enumerate(agent_entries, 1):
            lines.append(f"  Agent run {i} ({len(entry['steps'])} steps):")
            lines.append(f"    Path: {_journey_narrative(entry['steps'])}")
            for s in _summarise_journey(entry["steps"]):
                lines.append("    " + json.dumps(s))
        lines.append(f"Human journeys ({len(human_entries)}):")
        for i, entry in enumerate(human_entries, 1):
            lines.append(f"  Human run {i} ({len(entry['steps'])} steps):")
            lines.append(f"    Path: {_journey_narrative(entry['steps'])}")
            for s in _summarise_journey(entry["steps"]):
                lines.append("    " + json.dumps(s))

        # Pairwise similarity scores when embeddings are available
        sim_lines = []
        for ai, ae in enumerate(agent_entries, 1):
            a_emb = ae.get("embedding")
            if not a_emb:
                continue
            for hi, he in enumerate(human_entries, 1):
                h_emb = he.get("embedding")
                if h_emb:
                    score = _cosine(a_emb, h_emb)
                    sim_lines.append(f"  Agent run {ai} vs Human run {hi}: {score:.3f}")
        if sim_lines:
            lines.append("Similarity scores (cosine, 0–1):")
            lines.extend(sim_lines)
        lines.append("")
    return "\n".join(lines)


_NVIDIA_MODELS = {"meta/llama-3.3-70b-instruct"}
_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
_GOOGLE_MODEL = "gemini-2.0-flash"
_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
_NVIDIA_MODEL = "meta/llama-3.3-70b-instruct"


def run_comparative_analysis(
    site_url: str,
    journeys: list[dict],
    api_key: str | None = None,
    agent_api_key: str | None = None,
    agent_provider: str | None = None,
) -> dict:
    """
    journeys: list of journey dicts with keys: task_title, is_agent, steps (list[dict])
    Returns the parsed JSON dict from the LLM.
    Priority: Anthropic key → agent key (NVIDIA/Google) → env NVIDIA_API_KEY.
    """
    anthropic_key = api_key or settings.anthropic_api_key
    fallback_key = agent_api_key or settings.nvidia_api_key or settings.google_api_key
    if agent_provider:
        fallback_provider = agent_provider
    elif agent_api_key or settings.nvidia_api_key:
        fallback_provider = "nvidia"
    else:
        fallback_provider = "google"

    if not anthropic_key and not fallback_key:
        raise RuntimeError("No LLM API key configured — add one in API Key Settings")

    # Group by task_title → agent/human → list of entry dicts {steps, embedding}
    # Treat is_agent=None (old rows saved before column existed) as agent.
    grouped: dict[str, dict[str, list[dict]]] = {}
    for j in journeys:
        title = j["task_title"]
        bucket = "human" if j.get("is_agent") is False else "agent"
        grouped.setdefault(title, {"agent": [], "human": []})
        grouped[title][bucket].append({
            "steps": j["steps"],
            "embedding": j.get("embedding"),
        })

    if not grouped:
        raise ValueError("No journeys provided")

    user_content = _build_user_content(site_url, grouped)

    if anthropic_key:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=12000,
            thinking={"type": "enabled", "budget_tokens": 3000},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
            extra_headers={"anthropic-beta": "interleaved-thinking-2025-05-14"},
        )
        raw = next(b.text for b in msg.content if b.type == "text").strip()
    else:
        from openai import OpenAI
        if fallback_provider == "google":
            oa_client = OpenAI(api_key=fallback_key, base_url=_GOOGLE_BASE_URL)
            model = _GOOGLE_MODEL
        else:
            oa_client = OpenAI(api_key=fallback_key, base_url=_NVIDIA_BASE_URL)
            model = _NVIDIA_MODEL
        resp = oa_client.chat.completions.create(
            model=model,
            max_tokens=8192,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        raw = resp.choices[0].message.content.strip()

    return _post_process(_parse_llm_json(raw))


def _parse_llm_json(raw: str) -> dict:
    """Strip optional markdown fences then parse JSON. Raises ValueError on failure."""
    text = raw.strip()
    # Strip ```json ... ``` or ``` ... ``` wrappers that some models emit
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]  # drop opening fence line
        text = text.rsplit("```", 1)[0]  # drop closing fence
        text = text.strip()
    if not text:
        raise ValueError("LLM returned an empty response — try again")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        # Find the first '{' in case the model prepended prose
        brace = text.find("{")
        if brace != -1:
            try:
                return json.loads(text[brace:])
            except json.JSONDecodeError:
                pass
        raise ValueError(f"LLM response was not valid JSON: {exc}") from exc


def _post_process(result: dict) -> dict:
    """Remove blank and duplicate pain_points / recommendations from each task analysis."""
    import re

    def _norm(text: str) -> str:
        return re.sub(r"\W+", " ", text.lower().strip())[:80]

    if not isinstance(result, dict):
        return result

    for task in result.get("task_analyses", []):
        if not isinstance(task, dict):
            continue
        for key in ("pain_points", "recommendations"):
            items = task.get(key, [])
            seen: set[str] = set()
            cleaned = []
            for item in items:
                text = item.get("text", "").strip() if isinstance(item, dict) else str(item).strip()
                if not text:
                    continue
                norm = _norm(text)
                if norm in seen:
                    log.debug("Dedup: dropping duplicate %s item: %.60s", key, text)
                    continue
                seen.add(norm)
                if isinstance(item, dict):
                    _ensure_diagram(item)
                    if key == "pain_points" and not item.get("suggested_action", "").strip():
                        item["suggested_action"] = f"Review and fix: {item.get('text', '')}"
                cleaned.append(item)
            task[key] = cleaned

        _ensure_task_has_flow(task)
        _ensure_task_has_horizon(task)

    return result


def _has_view(item: dict, view: str) -> bool:
    return any(
        isinstance(d, dict) and d.get("view") == view
        for d in (item.get("diagrams") or [])
    )


def _ensure_task_has_flow(task: dict) -> None:
    """Guarantee at least one action point per task links to the Journey Flow
    (sankey) diagram. Weak fallback models often pick only compare/horizon, so
    we inject a sankey link into the most navigation-related point if missing."""
    points = [
        p for key in ("pain_points", "recommendations")
        for p in task.get(key, [])
        if isinstance(p, dict)
    ]
    if not points:
        return
    if any(_has_view(p, "sankey") for p in points):
        return

    def _flow_score(p: dict) -> int:
        text = (p.get("text") or "").lower()
        return sum(1 for kw in _FLOW_KEYWORDS if kw in text)

    # Prefer the point whose wording is most about navigation; fall back to first.
    target = max(points, key=_flow_score)
    point_type = target.get("type")
    side = "ai" if point_type == "agent_gap" else "human" if point_type == "human_issue" else "both"
    target.setdefault("diagrams", [])
    target["diagrams"].append({
        "view": "sankey",
        "reason": "Trace where AI and human journeys diverge through the navigation flow.",
        "highlight": {"side": side, "focus": "divergence"},
        "diagram_explanation": (
            "The journey-flow diagram shows how AI and human journeys move through the "
            "navigation milestones — the highlighted divergence points mark where the paths "
            "split, which is the evidence behind this action point."
        ),
    })


def _ensure_task_has_horizon(task: dict) -> None:
    """Guarantee at least one action point per task links to the Horizon Graph.
    Mirrors _ensure_task_has_flow but for timing/pacing insights."""
    points = [
        p for key in ("pain_points", "recommendations")
        for p in task.get(key, [])
        if isinstance(p, dict)
    ]
    if not points:
        return
    if any(_has_view(p, "horizon") for p in points):
        return

    def _horizon_score(p: dict) -> int:
        text = (p.get("text") or "").lower()
        return sum(1 for kw in _HORIZON_KEYWORDS if kw in text)

    target = max(points, key=_horizon_score)
    point_type = target.get("type")
    side = "ai" if point_type == "agent_gap" else "human" if point_type == "human_issue" else "both"
    action_types: list[str] = []
    text_lower = (target.get("text") or "").lower()
    for at, hints in _ACTION_TYPE_HINTS.items():
        if any(h in text_lower for h in hints):
            action_types.append(at)
    target.setdefault("diagrams", [])
    target["diagrams"].append({
        "view": "horizon",
        "reason": "See how AI and human action timing and pacing differ across the journey.",
        "highlight": {
            "side": side,
            **({"action_types": action_types} if action_types else {}),
        },
        "diagram_explanation": (
            "The horizon graph shows the density and rhythm of actions over time — "
            "the highlighted side reveals where timing and pacing diverge between AI and human."
        ),
    })


# The only diagram views that resolve to a real, highlightable dashboard view.
_VALID_DIAGRAM_VIEWS = {"compare", "sankey", "horizon", "heatmap", "human_agg"}

# Keywords that hint which diagram best evidences an action point.
_FLOW_KEYWORDS = (
    "navigat", "detour", "wrong turn", "dead end", "path", "route", "menu",
    "page", "link", "click through", "back", "backtrack", "flow", "step",
    "lost", "found", "reach", "fail", "drop", "bounce", "structure",
)
_HORIZON_KEYWORDS = (
    "time", "timing", "pacing", "rhythm", "front-load", "frontload", "back-load",
    "burst", "idle", "rush", "gradual", "slow", "fast", "duration", "spike",
    "concentrat", "explore", "scroll", "hesitat", "delay", "early", "late",
)
_ACTION_TYPE_HINTS = {
    "click_element": ("click", "button", "press", "tap"),
    "scroll": ("scroll",),
    "input_text": ("type", "typed", "input", "enter text", "form field"),
    "navigate": ("navigat", "url", "page load", "redirect"),
}


def _ensure_diagram(item: dict) -> None:
    """Guarantee every action point links to at least one diagram so the UI
    always shows a "Verify in diagrams" link. Models (especially the fallback
    providers) frequently omit the optional diagrams array; we pick the most
    relevant view (flow / horizon / compare) from the point's wording and the
    point type, with a proper highlight so the relevant parts light up just
    like the Human-vs-AI view."""
    # Drop any diagram referencing a view we can't actually link to / highlight.
    diagrams = item.get("diagrams")
    if isinstance(diagrams, list):
        valid = [d for d in diagrams if isinstance(d, dict) and d.get("view") in _VALID_DIAGRAM_VIEWS]
        item["diagrams"] = valid
        if len(valid) > 0:
            return
    point_type = item.get("type")
    side = "ai" if point_type == "agent_gap" else "human" if point_type == "human_issue" else "both"
    text = (item.get("text") or "").lower()

    flow_score = sum(1 for kw in _FLOW_KEYWORDS if kw in text)
    horizon_score = sum(1 for kw in _HORIZON_KEYWORDS if kw in text)

    if horizon_score > flow_score and horizon_score > 0:
        action_types = [at for at, hints in _ACTION_TYPE_HINTS.items() if any(h in text for h in hints)]
        highlight = {"side": side}
        if action_types:
            highlight["action_types"] = action_types[:2]
        item["diagrams"] = [{
            "view": "horizon",
            "reason": "Compare when in the journey AI and human activity is concentrated.",
            "highlight": highlight,
            "diagram_explanation": (
                "The activity-density curves show how AI and human pacing differ over the "
                "course of the task — look at where each curve peaks to see the evidence "
                "behind this action point."
            ),
        }]
    elif flow_score > 0:
        item["diagrams"] = [{
            "view": "sankey",
            "reason": "Trace where AI and human journeys diverge through the navigation flow.",
            "highlight": {"side": side, "focus": "divergence"},
            "diagram_explanation": (
                "The journey-flow diagram shows how AI and human journeys move through the "
                "navigation milestones — follow the highlighted side to see the detours or "
                "dead ends behind this action point."
            ),
        }]
    else:
        item["diagrams"] = [{
            "view": "compare",
            "reason": "Compare AI vs human effort and action mix for this task.",
            "highlight": {"side": side, "sections": ["stats", "steps_per_page"]},
            "diagram_explanation": (
                "Review the AI-vs-human step counts and per-page effort to see the evidence "
                "behind this action point."
            ),
        }]
