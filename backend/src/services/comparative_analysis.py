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
          "text": "specific UI/UX issue observed in either agent or human journeys",
          "type": "ux_issue" | "agent_gap" | "human_issue",
          "agent_explanation": "",
          "human_explanation": "",
          "agent_bullets": ["what the agent did differently from humans — ≤12 words, must ref step N or /url", "...", "..."],
          "human_bullets": ["what humans did naturally (target behaviour) — ≤12 words, must ref step N or /url", "...", "..."],
          "diagrams": [
            {"view": "compare" | "sankey" | "heatmap" | "multiflow" | "similarity" | "comparative" | "insights" | "human_agg" | "policy", "reason": "one sentence: what specifically to look for in this diagram that evidences the issue"}
          ]
        }
      ],
      "recommendations": [
        {
          "text": "concrete, actionable UX fix for the designer",
          "type": "ux_issue" | "agent_gap" | "human_issue",
          "agent_explanation": "",
          "human_explanation": "",
          "agent_bullets": ["what the agent did differently from humans — ≤12 words, must ref step N or /url", "...", "..."],
          "human_bullets": ["what humans did naturally (target behaviour) — ≤12 words, must ref step N or /url", "...", "..."],
          "diagrams": [
            {"view": "compare" | "sankey" | "heatmap", "reason": "one sentence: what this diagram shows that motivates this recommendation"}
          ]
        }
      ]
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
- Aim for 2–5 pain_points and 2–5 recommendations per task. Quality over quantity. If there are less, output less.
- For diagrams: select 0–3 diagrams per point — only those where the evidence is most directly visible. If no diagram genuinely shows this issue, use an empty array. Never pad with diagrams just for completeness. Avoid selecting multiple diagrams that show the same kind of evidence (e.g. "compare" and "insights" both show step counts — pick the better one, not both). Available views and what they show:
  * "compare" — side-by-side AI vs Human bar charts: total steps, unique pages visited, action-type breakdown (clicks/scrolls/inputs/backtracks), per-page step counts. Best for: effort differences, efficiency gaps, excessive backtracking, action-type anomalies.
  * "sankey" — page-to-page flow diagram; link width = number of sessions that took that transition. Best for: wrong turns, detours, dead ends, divergent navigation paths between agent and human.
  * "heatmap" — screenshot overlays with click density (red = many clicks, blue = few). Best for: missed click targets, wrong elements clicked, interaction patterns on a specific page, invisible or hard-to-find UI elements.
  * "multiflow" — every journey rendered in parallel swim lanes so you can see all runs at once. Best for: outlier runs, sessions that took a completely different path, spotting the one user who succeeded differently.
  * "similarity" — matrix of similarity scores between each AI run and each human session (0–1). Best for: how well-calibrated the agent is overall, whether one agent run was an outlier, whether human sessions cluster differently from agent sessions.
  * "comparative" — AI-generated written report covering pain points, differences, and recommendations across all journeys. Best for: pointing to a specific finding in the written analysis that directly names this issue.
  * "insights" — aggregated metrics: session counts, average steps, drop-off rates, time-on-page per step. Best for: quantifying drop-off at a specific page, confirming that a step takes disproportionately long, validating step-count claims with hard numbers.
  * "human_agg" — Sankey diagram of aggregated human navigation paths, sized by session count and coloured by frequency (green = common, red = rare). Best for: showing which paths real users actually take, identifying where users drop off or bounce, highlighting the dominant navigation flow vs. detours.
  * "policy" — AI agent re-run guided by the human-aggregate behavioural policy; shows how injecting real user context changes the agent's decisions. Best for: demonstrating whether the agent's deviations from human paths are correctable, validating that a navigation issue exists even with policy guidance.
- The platform goal is agent calibration: helping UX designers replace human testers with AI agents. Your analysis must distinguish between (a) genuine website UX problems and (b) agent calibration gaps where the agent simply behaves differently from humans.
- For `type` on each pain_point and recommendation: use "ux_issue" if both agent and human struggle, "agent_gap" if the agent deviates from human behaviour (calibration problem), "human_issue" if humans struggle but the agent does not.
- For agent_bullets: describe what the agent did DIFFERENTLY from the human (the deviation). Exactly 3 strings, ≤12 words each. MUST include at least one of: "step N", "/url-path", or UI element name in quotes. Do NOT write "The agent..." — state the observation directly.
- For human_bullets: describe what humans did NATURALLY (the target behaviour the agent should learn). Exactly 3 strings, ≤12 words each. MUST include at least one of: "step N", "/url-path", or UI element name in quotes.
  Good agent bullet: "Took detour to /team at step 2, humans went direct to /kontakt"
  Good human bullet: "Clicked footer 'Kontakt' link directly at step 1"
  Bad: ["The agent had difficulty finding contact information", "Navigation was confusing", "Human users also struggled"]
- Leave agent_explanation and human_explanation as empty strings "".
- For calibration_summary: if similarity scores are available, state the score and interpret it (e.g. "Agent similarity 0.42 — low calibration, agent took a markedly different path than humans"). If no scores, derive qualitatively from step sequences. Flag tasks where agent path diverges markedly as calibration priorities.
- For diagrams: select at most 2 per point — one for agent evidence, one for human evidence if genuinely different. For "agent_gap" type points, prefer "policy" first (shows what happens when human context is injected into the agent). For "ux_issue" type, prefer "sankey" or "heatmap". Never pad — if only 1 diagram genuinely shows the evidence, use 1. Empty array is valid.
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
    dot = sum(x * y for x, y in zip(a, b))
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
            lines.append(f"Similarity scores (cosine, 0–1):")
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
    fallback_key = agent_api_key or settings.nvidia_api_key
    fallback_provider = agent_provider or "nvidia"

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
            betas=["interleaved-thinking-2025-05-14"],
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

    return _parse_llm_json(raw)


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
