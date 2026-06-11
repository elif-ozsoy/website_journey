"""
Solution evaluator: compares an agent's final answer against a UX designer's
expected solution and returns a three-tier verdict via a fast LLM call.
"""
from __future__ import annotations

import json
import os
import re

EVAL_SYSTEM_PROMPT = """\
You are a UX test evaluator. An AI agent completed a task and provided a final answer.
Compare it against the expected solution and return ONLY a JSON object — no markdown, no extra text:
{"result": "correct" | "partially_correct" | "false_or_misleading", "reason": "one sentence"}

Rules:
- "correct": the agent's answer matches the expected solution in substance
- "partially_correct": the agent's answer is related but incomplete or imprecise
- "false_or_misleading": the agent's answer is wrong, irrelevant, or misleading
"""


def evaluate_solution(
    agent_answer: str,
    expected_solution: str,
    api_key: str,
    llm_provider: str,
) -> dict | None:
    """
    Synchronous function — call via asyncio.run_in_executor from async code.

    Returns:
        {
            "result": "correct" | "partially_correct" | "false_or_misleading",
            "reason": str (one sentence, ≤ 400 chars),
        }
        or None if the evaluation fails for any reason.
    """
    try:
        from openai import OpenAI

        if llm_provider == "nvidia" and api_key:
            client = OpenAI(
                base_url="https://integrate.api.nvidia.com/v1",
                api_key=api_key,
            )
            model = "meta/llama-4-maverick-17b-128e-instruct"
        elif llm_provider == "google" and api_key:
            # Use OpenAI-compatible Gemini endpoint — no extra SDK needed
            client = OpenAI(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=api_key,
            )
            model = "gemini-2.0-flash"
        else:
            # Local OpenAI-compatible server
            client = OpenAI(
                base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1"),
                api_key=os.getenv("LOCAL_LLM_API_KEY", "not-needed"),
            )
            model = os.getenv("LOCAL_LLM_MODEL", "local-model")

        user_msg = (
            f"EXPECTED SOLUTION:\n{expected_solution}\n\n"
            f"AGENT'S FINAL ANSWER:\n{agent_answer}"
        )

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": EVAL_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=128,
            timeout=5,
        )
        raw = resp.choices[0].message.content.strip()

        # Extract JSON object even if the model wraps it in markdown
        m = re.search(r'\{[^}]+\}', raw, re.DOTALL)
        if not m:
            return None

        parsed = json.loads(m.group())
        result_val = parsed.get("result")
        if result_val not in ("correct", "partially_correct", "false_or_misleading"):
            return None

        return {
            "result": result_val,
            "reason": str(parsed.get("reason", ""))[:400],
        }

    except Exception:
        return None
