"""
Shared LLM call helper for the explain/annotate endpoints.

All endpoints follow the same provider strategy:

1. If an Anthropic key is available, call the Anthropic Messages API
   (optionally retrying transient network errors and 5xx responses).
2. If Anthropic fails (or no key) and a Google key is available, call
   Gemini through its OpenAI-compatible endpoint with the same payload.
3. If every provider fails, raise HTTPException(502) so the client sees
   an explicit error instead of a silently empty result.

Keys are resolved per-request: the frontend forwards user-entered keys via
``X-Anthropic-Key`` / ``X-Google-Key`` headers, with environment variables
as the server-side fallback.
"""

from __future__ import annotations

import asyncio
import os
import ssl
from typing import Any

import httpx
from fastapi import HTTPException, Request

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

_GOOGLE_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
_CLAUDE_TO_GEMINI: dict[str, str] = {
    "claude-sonnet-4-6": "gemini-2.0-flash",
    "claude-haiku-4-5-20251001": "gemini-2.0-flash",
}

RETRYABLE_ERRORS = (
    httpx.ReadError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
    ssl.SSLError,
)


def _resolve_anthropic_key(request: Request) -> str | None:
    return request.headers.get("x-anthropic-key") or os.environ.get("ANTHROPIC_API_KEY") or None


def _resolve_google_key(request: Request) -> str | None:
    return request.headers.get("x-google-key") or os.environ.get("GOOGLE_API_KEY") or None


def resolve_keys(request: Request) -> tuple[str | None, str | None]:
    """Return (anthropic_key, google_key); raise 503 if neither is configured."""
    ak = _resolve_anthropic_key(request)
    gk = _resolve_google_key(request)
    # When the user has Google selected in API key settings, the key arrives as
    # X-Agent-Api-Key with X-Agent-Provider: google
    if not gk:
        agent_key = request.headers.get("x-agent-api-key") or None
        agent_provider = request.headers.get("x-agent-provider") or None
        if agent_key and agent_provider == "google":
            gk = agent_key
    if not ak and not gk:
        raise HTTPException(status_code=503, detail="No LLM API key configured (Anthropic or Google)")
    return ak, gk


def _to_openai_content(content: Any) -> Any:
    if isinstance(content, str):
        return content
    out = []
    for item in content:
        if item.get("type") == "text":
            out.append({"type": "text", "text": item["text"]})
        elif item.get("type") == "image":
            src = item["source"]
            if src["type"] == "base64":
                url = f"data:{src['media_type']};base64,{src['data']}"
                out.append({"type": "image_url", "image_url": {"url": url}})
    return out


async def call_google_fallback(payload: dict, google_key: str, timeout: float = 60.0) -> str:
    """Call Gemini via OpenAI-compatible endpoint using an Anthropic-format payload."""
    model = _CLAUDE_TO_GEMINI.get(payload.get("model", ""), "gemini-2.0-flash")
    messages: list[dict] = []
    if "system" in payload:
        messages.append({"role": "system", "content": payload["system"]})
    for msg in payload.get("messages", []):
        messages.append({"role": msg["role"], "content": _to_openai_content(msg["content"])})
    oa_payload = {"model": model, "max_tokens": payload.get("max_tokens", 1024), "messages": messages}
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            _GOOGLE_CHAT_URL,
            json=oa_payload,
            headers={"Authorization": f"Bearer {google_key}", "content-type": "application/json"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Google API error: {resp.text[:300]}")
    return resp.json()["choices"][0]["message"]["content"]


async def call_anthropic(payload: dict, api_key: str, *, timeout: float, attempts: int = 1) -> str:
    """Call the Anthropic Messages API; retry transient errors / 5xx up to *attempts* times."""
    last_detail = "Anthropic API error"
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(15.0, timeout))) as client:
                resp = await client.post(
                    ANTHROPIC_URL,
                    json=payload,
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": ANTHROPIC_VERSION,
                        "content-type": "application/json",
                    },
                )
            if resp.status_code == 200:
                return resp.json()["content"][0]["text"]
            last_detail = f"Anthropic API error: {resp.text[:300]}"
            if resp.status_code < 500:
                break  # 4xx — don't retry
        except RETRYABLE_ERRORS as exc:
            last_detail = f"Anthropic API unreachable: {exc}"
        if attempt < attempts - 1:
            await asyncio.sleep(1.0 * (attempt + 1))
    raise HTTPException(status_code=502, detail=last_detail)


async def call_llm(
    payload: dict,
    anthropic_key: str | None,
    google_key: str | None,
    *,
    timeout: float = 20.0,
    attempts: int = 1,
) -> str:
    """Anthropic first, Google as fallback; HTTPException(502) if all providers fail."""
    if anthropic_key:
        try:
            return await call_anthropic(payload, anthropic_key, timeout=timeout, attempts=attempts)
        except HTTPException:
            if not google_key:
                raise
    return await call_google_fallback(payload, google_key, timeout=timeout)
