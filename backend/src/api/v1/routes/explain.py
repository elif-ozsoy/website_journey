import base64
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_db

router = APIRouter()


def _resolve_api_key(request: Request) -> str:
    key = request.headers.get("x-anthropic-key") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured")
    return key

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


@router.post("/explain-agent", response_model=ExplainResponse)
async def explain_agent(body: ExplainRequest, request: Request) -> ExplainResponse:
    api_key = _resolve_api_key(request)

    if not body.steps:
        raise HTTPException(status_code=400, detail="steps must not be empty")

    prompt = _build_prompt(body)

    payload = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 1500,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:300]}")

    data = resp.json()
    text = data["content"][0]["text"]
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
    api_key = _resolve_api_key(request)

    if not body.agent_thoughts:
        raise HTTPException(status_code=400, detail="No agent thoughts provided")

    parts = [f"Action point: {body.action_point}", f"Task: {body.task_title}\n", "Agent reasoning:"]
    for t in body.agent_thoughts[:6]:
        parts.append(f"  - {t[:300]}")
    parts.append("\nWrite exactly two short paragraphs explaining what this agent behaviour reveals about the action point.")
    prompt = "\n".join(parts)

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _EXPLAIN_AGENT_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:200]}")

    return ExplainAgentPerspectiveResponse(explanation=resp.json()["content"][0]["text"].strip())


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
    api_key = _resolve_api_key(request)

    parts = [f"Action point: {body.action_point}", f"Task: {body.task_title}\n"]

    if body.human_narratives:
        parts.append("Observed human behaviour:")
        for n in body.human_narratives[:5]:
            parts.append(f"  - {n}")

    if body.ratings and body.ratings.count > 0:
        r = body.ratings
        scores = []
        if r.overall is not None:
            scores.append(f"overall {r.overall:.1f}/5")
        if r.navigation is not None:
            scores.append(f"navigation {r.navigation:.1f}/5")
        if r.design is not None:
            scores.append(f"design {r.design:.1f}/5")
        parts.append(f"\nRatings (n={r.count}): {', '.join(scores)}")

    if body.human_comments:
        parts.append("Tester comments:")
        for c in body.human_comments[:5]:
            parts.append(f'  "{c}"')

    if not body.human_narratives and not body.human_comments:
        raise HTTPException(status_code=400, detail="No human data provided")

    parts.append("\nWrite exactly two short paragraphs explaining what this human evidence reveals about the action point.")
    prompt = "\n".join(parts)

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _EXPLAIN_HUMAN_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:200]}")

    return ExplainHumanResponse(explanation=resp.json()["content"][0]["text"].strip())


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
    api_key = _resolve_api_key(request)

    parts = [f"Action point: {body.action_point}\n"]

    if body.agent_thoughts:
        parts.append("Agent thoughts:")
        for t in body.agent_thoughts[:5]:
            parts.append(f'  "{t}"')
    else:
        parts.append("Agent thoughts: (none relevant)")

    if body.ratings and body.ratings.count > 0:
        r = body.ratings
        rating_parts = []
        if r.overall is not None:
            rating_parts.append(f"overall {r.overall:.1f}/5")
        if r.navigation is not None:
            rating_parts.append(f"navigation {r.navigation:.1f}/5")
        if r.design is not None:
            rating_parts.append(f"design {r.design:.1f}/5")
        parts.append(f"\nHuman ratings (n={r.count}): {', '.join(rating_parts)}")
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
    prompt = "\n".join(parts)

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "system": _SYNTH_SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:200]}")

    return SynthesizeResponse(summary=resp.json()["content"][0]["text"].strip())


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
    api_key = _resolve_api_key(request)

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

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:200]}")

    return DiagramLinkResponse(explanation=resp.json()["content"][0]["text"].strip().rstrip("."))


# ─── Screenshot annotation endpoint ──────────────────────────────────────────

class AnnotateRequest(BaseModel):
    screenshot_id: int
    issue_text: str


class AnnotateResponse(BaseModel):
    x: float        # 0–1 normalised
    y: float        # 0–1 normalised
    width: float    # 0–1 normalised
    height: float   # 0–1 normalised
    found: bool


_ANNOTATE_SYSTEM = (
    "You are a UI element locator. Given a screenshot and a description of a UX issue, "
    "identify where on the screen the problematic UI element or area is located. "
    "Respond ONLY with a JSON object: "
    '{"x": <0-1>, "y": <0-1>, "width": <0-1>, "height": <0-1>, "found": true} '
    "where x,y are the top-left corner and width/height are the bounding box, "
    "all as fractions of the total image dimensions (0 to 1). "
    'If you cannot identify a specific element, respond with {"found": false}.'
)


@router.post("/annotate-screenshot", response_model=AnnotateResponse)
async def annotate_screenshot(
    body: AnnotateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AnnotateResponse:
    api_key = _resolve_api_key(request)

    from models.screenshot import Screenshot
    sc = db.get(Screenshot, body.screenshot_id)
    if not sc or not sc.file_path or not os.path.exists(sc.file_path):
        raise HTTPException(status_code=404, detail="Screenshot not found")

    with open(sc.file_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    ext = sc.file_path.rsplit(".", 1)[-1].lower()
    media_type = "image/png" if ext == "png" else "image/jpeg"

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 128,
        "system": _ANNOTATE_SYSTEM,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_b64}},
                {"type": "text", "text": f"UX issue: {body.issue_text}"},
            ],
        }],
    }

    import asyncio
    import ssl

    _RETRYABLE = (
        httpx.ReadError,
        httpx.ConnectError,
        httpx.ConnectTimeout,
        httpx.ReadTimeout,
        httpx.RemoteProtocolError,
        ssl.SSLError,
    )

    last_exc: Exception | None = None
    resp = None
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    json=payload,
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                )
            if resp.status_code == 200:
                break
            if resp.status_code >= 500:
                await asyncio.sleep(1.0 * (attempt + 1))
                continue
            break  # 4xx — don't retry
        except _RETRYABLE as exc:
            last_exc = exc
            await asyncio.sleep(1.0 * (attempt + 1))

    if resp is None:
        raise HTTPException(status_code=502, detail=f"Anthropic API unreachable: {last_exc}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:300]}")

    import json
    raw = resp.json()["content"][0]["text"].strip()
    try:
        data = json.loads(raw)
        if not data.get("found", False):
            return AnnotateResponse(x=0, y=0, width=0, height=0, found=False)
        return AnnotateResponse(
            x=float(data.get("x", 0)),
            y=float(data.get("y", 0)),
            width=float(data.get("width", 0.2)),
            height=float(data.get("height", 0.1)),
            found=True,
        )
    except Exception:
        return AnnotateResponse(x=0, y=0, width=0, height=0, found=False)
