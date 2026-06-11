"""Text explanation endpoints: agent/human perspectives, synthesis, diagram links.

Screenshot vision endpoints (annotate/select) live in annotate.py.
All LLM calls go through services.llm_client.call_llm, which handles the
Anthropic → Google fallback chain and raises 502 when every provider fails.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.llm_client import call_llm, resolve_keys

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a UX analyst. You will receive: "
    "(1) an AI agent's internal reasoning (thoughts) and actions from a browser-use session, "
    "and (2) feedback from human testers who used the same website. "
    "Synthesise these two sources to explain WHY the website produces these results — "
    "what UX patterns, friction points, or design decisions cause both the agent's "
    "behaviour and the human reactions. "
    "Structure your answer with these four sections: "
    "Goal interpretation, Navigation strategy & key decisions, "
    "Friction observed, Human vs AI comparison. "
    "Each section: 2–4 sentences of plain prose. No bullet sub-lists."
)


class RatingsSummary(BaseModel):
    count: int = 0
    overall: float | None = None
    navigation: float | None = None
    design: float | None = None
    comments: list[str] = []


class ExplainRequest(BaseModel):
    steps: list[dict[str, Any]]
    ratings: RatingsSummary | None = None


class ExplainResponse(BaseModel):
    explanation: str


def _build_prompt(body: ExplainRequest) -> str:
    parts: list[str] = ["=== AI Agent browser-use session ===\n"]

    for i, step in enumerate(body.steps[:50], 1):
        url = step.get("url", "")
        action = step.get("action_type", "")
        thought = (step.get("thought") or "").strip()
        parts.append(f"Step {i}: [{action}] on {url}")
        if thought:
            parts.append(f"  Reasoning: {thought}")

    if body.ratings and body.ratings.count > 0:
        r = body.ratings
        parts.append(f"\n=== Human tester feedback (n={r.count}) ===")
        if r.overall is not None:
            parts.append(f"Overall experience: {r.overall:.1f}/5")
        if r.navigation is not None:
            parts.append(f"Navigation ease: {r.navigation:.1f}/5")
        if r.design is not None:
            parts.append(f"Visual design: {r.design:.1f}/5")
        if r.comments:
            parts.append("Tester comments:")
            for c in r.comments[:8]:
                parts.append(f'  "{c}"')
    else:
        parts.append("\n=== Human tester feedback ===\nNo tester ratings recorded yet.")

    parts.append("\nNow write the four-section analysis.")
    return "\n".join(parts)


def _ratings_lines(ratings: RatingsSummary | None) -> list[str]:
    """Format a ratings summary as prompt lines; empty list when no ratings."""
    if not ratings or ratings.count == 0:
        return []
    scores = []
    if ratings.overall is not None:
        scores.append(f"overall {ratings.overall:.1f}/5")
    if ratings.navigation is not None:
        scores.append(f"navigation {ratings.navigation:.1f}/5")
    if ratings.design is not None:
        scores.append(f"design {ratings.design:.1f}/5")
    return [f"\nRatings (n={ratings.count}): {', '.join(scores)}"]


@router.post("/explain-agent", response_model=ExplainResponse)
async def explain_agent(body: ExplainRequest, request: Request) -> ExplainResponse:
    anthropic_key, google_key = resolve_keys(request)

    if not body.steps:
        raise HTTPException(status_code=400, detail="steps must not be empty")

    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1500,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": _build_prompt(body)}],
    }
    text = await call_llm(payload, anthropic_key, google_key, timeout=60.0)
    return ExplainResponse(explanation=text)


# ─── Agent-perspective explanation endpoint ──────────────────────────────────

class ExplainAgentPerspectiveRequest(BaseModel):
    action_point: str
    task_title: str
    agent_thoughts: list[str] = []


class ExplainAgentPerspectiveResponse(BaseModel):
    explanation: str


_EXPLAIN_AGENT_SYSTEM = (
    "You are a UX researcher analysing AI agent behaviour. Given a usability action point and "
    "the agent's internal reasoning from a browser-use session, write 2–3 sentences explaining "
    "what the agent's behaviour specifically reveals about this issue. "
    "Be concrete — reference actual decisions or observations the agent made. "
    "Use **double asterisks** around the most important words or short phrases (UI element names, "
    "key actions, verdicts). Always write exactly two paragraphs separated by a blank line, "
    "each paragraph ONE sentence only. No headers, no bullet points. Write from the agent perspective only."
)


@router.post("/explain-agent-perspective", response_model=ExplainAgentPerspectiveResponse)
async def explain_agent_perspective(body: ExplainAgentPerspectiveRequest, request: Request) -> ExplainAgentPerspectiveResponse:
    anthropic_key, google_key = resolve_keys(request)

    if not body.agent_thoughts:
        raise HTTPException(status_code=400, detail="No agent thoughts provided")

    parts = [f"Action point: {body.action_point}", f"Task: {body.task_title}\n", "Agent reasoning:"]
    for t in body.agent_thoughts[:6]:
        parts.append(f"  - {t[:300]}")
    parts.append("\nWrite exactly two short paragraphs explaining what this agent behaviour reveals about the action point.")

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _EXPLAIN_AGENT_SYSTEM,
        "messages": [{"role": "user", "content": "\n".join(parts)}],
    }
    text = await call_llm(payload, anthropic_key, google_key, timeout=20.0)
    return ExplainAgentPerspectiveResponse(explanation=text.strip())


# ─── Human-perspective explanation endpoint ──────────────────────────────────

class ExplainHumanRequest(BaseModel):
    action_point: str
    task_title: str
    human_narratives: list[str] = []
    human_comments: list[str] = []
    ratings: RatingsSummary | None = None


class ExplainHumanResponse(BaseModel):
    explanation: str


_EXPLAIN_HUMAN_SYSTEM = (
    "You are a UX researcher. Given a usability action point, real human user behaviour "
    "(observed actions on the site), and tester feedback, write 2–3 sentences explaining "
    "what the human evidence specifically reveals about this issue. "
    "Be concrete — reference actual actions or feedback where available. "
    "Use **double asterisks** around the most important words or short phrases (pain points, "
    "key behaviours, ratings, quotes). Always write exactly two paragraphs separated by a blank line, "
    "each paragraph ONE sentence only. No headers, no bullet points. Write from the human perspective only."
)


@router.post("/explain-human", response_model=ExplainHumanResponse)
async def explain_human(body: ExplainHumanRequest, request: Request) -> ExplainHumanResponse:
    anthropic_key, google_key = resolve_keys(request)

    if not body.human_narratives and not body.human_comments:
        raise HTTPException(status_code=400, detail="No human data provided")

    parts = [f"Action point: {body.action_point}", f"Task: {body.task_title}\n"]

    if body.human_narratives:
        parts.append("Observed human behaviour:")
        for n in body.human_narratives[:5]:
            parts.append(f"  - {n}")

    parts.extend(_ratings_lines(body.ratings))

    if body.human_comments:
        parts.append("Tester comments:")
        for c in body.human_comments[:5]:
            parts.append(f'  "{c}"')

    parts.append("\nWrite exactly two short paragraphs explaining what this human evidence reveals about the action point.")

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _EXPLAIN_HUMAN_SYSTEM,
        "messages": [{"role": "user", "content": "\n".join(parts)}],
    }
    text = await call_llm(payload, anthropic_key, google_key, timeout=20.0)
    return ExplainHumanResponse(explanation=text.strip())


# ─── Perspectives synthesis endpoint ─────────────────────────────────────────

class SynthesizeRequest(BaseModel):
    action_point: str
    agent_thoughts: list[str] = []
    human_comments: list[str] = []
    ratings: RatingsSummary | None = None


class SynthesizeResponse(BaseModel):
    summary: str


_SYNTH_SYSTEM = (
    "You are a concise UX analyst. Given a usability action point, relevant AI agent thoughts "
    "from a browser-use session, and human tester feedback, write 2–3 sentences that explain "
    "whether both sides confirm the issue, contradict each other, or add nuance. "
    "Be specific to the evidence given. No headers, no bullet points."
)


@router.post("/synthesize-perspectives", response_model=SynthesizeResponse)
async def synthesize_perspectives(body: SynthesizeRequest, request: Request) -> SynthesizeResponse:
    anthropic_key, google_key = resolve_keys(request)

    parts = [f"Action point: {body.action_point}\n"]

    if body.agent_thoughts:
        parts.append("Agent thoughts:")
        for t in body.agent_thoughts[:5]:
            parts.append(f'  "{t}"')
    else:
        parts.append("Agent thoughts: (none relevant)")

    rating_lines = _ratings_lines(body.ratings)
    if rating_lines:
        parts.extend(rating_lines)
        if body.human_comments:
            parts.append("Human comments:")
            for c in body.human_comments[:5]:
                parts.append(f'  "{c}"')
    elif body.human_comments:
        parts.append("\nHuman comments:")
        for c in body.human_comments[:5]:
            parts.append(f'  "{c}"')
    else:
        parts.append("\nHuman feedback: (none)")

    parts.append("\nSynthesize in 2–3 sentences.")

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _SYNTH_SYSTEM,
        "messages": [{"role": "user", "content": "\n".join(parts)}],
    }
    text = await call_llm(payload, anthropic_key, google_key, timeout=20.0)
    return SynthesizeResponse(summary=text.strip())


# ─── Diagram-link explanation endpoint ───────────────────────────────────────

class DiagramLinkRequest(BaseModel):
    action_point: str
    diagram_type: str   # 'compare' | 'sankey' | 'heatmap'
    stats: dict[str, Any] = {}


class DiagramLinkResponse(BaseModel):
    explanation: str


_DIAGRAM_LINK_SYSTEM = (
    "You are a UX data analyst. Given an action point (a usability issue or recommendation) "
    "and quantitative statistics from a research study comparing AI agent and human user journeys, "
    "write ONE concise sentence (max 25 words) that explains specifically how the data visible in "
    "the named diagram directly evidences or leads to this action point. "
    "Be concrete: reference the actual numbers from stats. Do not start with 'This' or repeat "
    "the diagram name. Respond with only the sentence, no punctuation at the end."
)


def _diagram_context(diagram_type: str) -> str:
    ctx = {
        "compare": "AI vs Human side-by-side panel showing step counts, unique pages, click rates, action breakdowns",
        "sankey":  "Sankey flow diagram showing page-to-page navigation transitions with link width = journey count",
        "heatmap": "Page heatmap with click density overlay where red = many clicks, blue = few clicks",
    }
    return ctx.get(diagram_type, diagram_type)


@router.post("/explain-diagram-link", response_model=DiagramLinkResponse)
async def explain_diagram_link(body: DiagramLinkRequest, request: Request) -> DiagramLinkResponse:
    anthropic_key, google_key = resolve_keys(request)

    stat_lines = "\n".join(f"  {k}: {v}" for k, v in body.stats.items() if v is not None)
    prompt = (
        f"Action point: {body.action_point}\n\n"
        f"Diagram: {_diagram_context(body.diagram_type)}\n\n"
        f"Stats:\n{stat_lines or '  (no stats available)'}\n\n"
        "How does what you see in this diagram directly evidence the action point above?"
    )

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 80,
        "system": _DIAGRAM_LINK_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }
    text = await call_llm(payload, anthropic_key, google_key, timeout=20.0)
    return DiagramLinkResponse(explanation=text.strip().rstrip("."))
