"""
browser-use integration: injects the human behavioral policy into agent prompts
and records a per-step XAI trace that explains AI vs. human decision alignment.

Typical usage:
    extractor = PolicyExtractor()
    policy = await extractor.build_policy(site_id, db_conn)

    agent = PolicyAwareBrowserAgent(site_id=site_id, policy=policy, extractor=extractor)
    result = await agent.run(
        url=url, task=task,
        llm_provider="nvidia", api_key="...", model=None,
        step_callback=my_cb, status_callback=my_status_cb,
        trace_output_path="xai_trace.json",
    )
    # result["xai_trace"] contains the per-step records
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable, Coroutine
from urllib.parse import urlparse

from .policy_extractor import PolicyExtractor

log = logging.getLogger(__name__)


class PolicyAwareBrowserAgent:
    """
    Wraps a browser-use agent runner with policy-based prompt injection.

    Policy is injected at two levels:
      1. Initial task  — the starting URL's policy is prepended so the LLM
                         knows what humans do on page 1 before it acts.
      2. Full overview — a compact summary of ALL pages is appended so the
                         agent can anticipate future navigation choices.

    A per-step XAI trace is built from the step_callback stream. Each entry
    records what the human majority would have done and whether the AI matched.
    """

    def __init__(
        self,
        site_id: str,
        policy: dict,
        extractor: PolicyExtractor | None = None,
    ) -> None:
        self.site_id = site_id
        self.policy = policy
        self.extractor = extractor or PolicyExtractor()
        self.xai_trace: list[dict] = []

    # ── Public run method ──────────────────────────────────────────────────────

    async def run(
        self,
        url: str,
        task: str,
        llm_provider: str,
        api_key: str,
        model: str | None,
        step_callback: Callable[[dict], Coroutine],
        status_callback: Callable[[str], Coroutine],
        run_agent_fn: Callable | None = None,
        trace_output_path: str | None = None,
    ) -> dict:
        """
        Run the browser agent with policy injection.

        Args:
            run_agent_fn: Optional override for the underlying agent runner.
                          Must match the signature of `agent_runner.run_browser_agent`.
                          Defaults to importing from backend services.
        """
        if run_agent_fn is None:
            run_agent_fn = self._default_run_agent_fn()

        augmented_task = self._build_augmented_task(url, task)
        self.xai_trace = []
        step_counter = 0

        async def _wrapped_step_callback(step_data: dict) -> None:
            nonlocal step_counter
            step_counter += 1
            trace_entry = self._build_trace_entry(step_counter, step_data)
            self.xai_trace.append(trace_entry)
            log.debug(
                "Step %d on %s — AI: %r | human top: %r (%.0f%%) | followed: %s",
                step_counter,
                trace_entry["path"],
                trace_entry["ai_action"],
                trace_entry["human_top_action"],
                trace_entry["human_top_action_frequency"] * 100,
                trace_entry["ai_followed_policy"],
            )
            await step_callback(step_data)

        result = await run_agent_fn(
            url=url,
            task=augmented_task,
            llm_provider=llm_provider,
            api_key=api_key,
            model=model,
            step_callback=_wrapped_step_callback,
            status_callback=status_callback,
        )

        if trace_output_path:
            self._save_trace(trace_output_path, url, task)

        return {**result, "xai_trace": self.xai_trace}

    # ── Task augmentation ──────────────────────────────────────────────────────

    def _build_augmented_task(self, url: str, task: str) -> str:
        start_path = urlparse(url).path or "/"
        start_injection = self.extractor.generate_prompt_injection(start_path, self.policy)
        overview = self._build_policy_overview()
        return (
            f"{task}\n\n"
            f"IMPORTANT: Behave like the average human user. "
            f"Follow the action distributions below.\n\n"
            f"{start_injection}\n\n"
            f"{overview}"
        )

    def _build_policy_overview(self) -> str:
        if not self.policy:
            return ""
        lines = ["<human_policy_overview>"]
        for path, page_pol in sorted(self.policy.items()):
            dist = page_pol.get("action_distribution", [])
            if dist:
                top = dist[0]
                pct = round(top["frequency"] * 100)
                label = top.get("text") or top.get("href") or "?"
                n = page_pol.get("n_sessions", 0)
                lines.append(f'  {path} ({n} sessions): top action "{label}" [{pct}%]')
        lines.append("</human_policy_overview>")
        return "\n".join(lines)

    # ── XAI trace building ─────────────────────────────────────────────────────

    def _build_trace_entry(self, step_num: int, step_data: dict) -> dict:
        step_url = step_data.get("url", "")
        step_path = urlparse(step_url).path if step_url else ""

        # Describe the AI's action in a human-readable way
        action_type = step_data.get("action_type", "")
        details = step_data.get("action_details") or {}
        ai_action = self._describe_ai_action(action_type, details)

        # Look up the human policy for this page
        page_policy = self.extractor.get_policy_for_page(step_path, self.policy)

        policy_injected = page_policy is not None
        match_type: str = "none"
        human_top_action: str = ""
        human_top_freq: float = 0.0
        ai_followed = False
        n_sessions: int = 0

        if page_policy:
            match_type = page_policy.get("_match_type", "exact")
            n_sessions = page_policy.get("n_sessions", 0)
            dist = page_policy.get("action_distribution", [])
            if dist:
                top = dist[0]
                human_top_action = top.get("text") or top.get("href") or ""
                human_top_freq = top.get("frequency", 0.0)
                # Soft match: check if AI description contains the human top label
                if human_top_action and human_top_action.lower() in ai_action.lower():
                    ai_followed = True

        return {
            "step": step_num,
            "url": step_url,
            "path": step_path,
            "policy_injected": policy_injected,
            "policy_match_type": match_type,
            "human_top_action": human_top_action,
            "human_top_action_frequency": human_top_freq,
            "ai_action": ai_action,
            "ai_followed_policy": ai_followed,
            "n_human_sessions": n_sessions,
        }

    @staticmethod
    def _describe_ai_action(action_type: str, details: dict) -> str:
        if not action_type or action_type == "unknown":
            return "unknown"
        text = details.get("text") or details.get("value") or ""
        url = details.get("url") or details.get("href") or ""
        if text:
            return f'{action_type}: "{text}"'
        if url:
            return f"{action_type}: {url}"
        if details:
            first_val = next(iter(details.values()), "")
            if first_val:
                return f"{action_type}: {first_val}"
        return action_type

    # ── Trace persistence ──────────────────────────────────────────────────────

    def _save_trace(self, path: str, url: str, task: str) -> None:
        payload = {
            "site_id": self.site_id,
            "url": url,
            "task": task,
            "xai_trace": self.xai_trace,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        log.info("XAI trace saved to %s (%d steps)", path, len(self.xai_trace))

    # ── Default runner import ──────────────────────────────────────────────────

    @staticmethod
    def _default_run_agent_fn() -> Callable:
        try:
            from backend.src.services.agent_runner import run_browser_agent
            return run_browser_agent
        except ImportError:
            pass
        try:
            from services.agent_runner import run_browser_agent  # type: ignore
            return run_browser_agent
        except ImportError:
            raise ImportError(
                "Could not import run_browser_agent. "
                "Pass run_agent_fn= explicitly or ensure the backend package is on sys.path."
            )
