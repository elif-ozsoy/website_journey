import base64
import importlib
import json as _json
import os
import re
import struct
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

from browser_use.llm.openai.chat import ChatOpenAI as _ChatOpenAI
from browser_use.llm.openai.chat import ChatInvokeCompletion
from browser_use.llm.openai.serializer import OpenAIMessageSerializer
from browser_use import Browser


class _OllamaChatOpenAI(_ChatOpenAI):
    """ChatOpenAI variant for local Ollama: uses json_object (not json_schema) to avoid hangs."""

    async def ainvoke(self, messages, output_format=None, **kwargs):
        if output_format is None:
            return await super().ainvoke(messages, None, **kwargs)

        openai_messages = OpenAIMessageSerializer.serialize_messages(messages)

        schema_text = _json.dumps(output_format.model_json_schema())
        instruction = f"\n\nRespond ONLY with a JSON object matching this schema (no markdown):\n{schema_text}"
        if openai_messages and openai_messages[0]["role"] == "system":
            if isinstance(openai_messages[0]["content"], str):
                openai_messages[0]["content"] += instruction

        response = await self.get_client().chat.completions.create(
            model=self.model,
            messages=openai_messages,
            response_format={"type": "json_object"},
        )

        content = (response.choices[0].message.content or "").strip()
        content = re.sub(r"^```(?:json)?\s*\n?", "", content)
        content = re.sub(r"\n?```\s*$", "", content)

        parsed = output_format.model_validate_json(content)
        return ChatInvokeCompletion(
            completion=parsed,
            usage=self._get_usage(response),
            stop_reason=response.choices[0].finish_reason,
        )


@dataclass
class ElementCoordinates:
    x: float
    y: float
    width: float
    height: float


@dataclass
class AgentStepData:
    step_number: int
    url: str
    title: str
    action_type: str
    action_details: dict
    reasoning: str
    thought: str
    next_goal: str
    screenshot_base64: str
    element_coordinates: ElementCoordinates | None
    timestamp: float
    outcome: str | None = None   # 'success' | 'failed' | 'incomplete' | None


def _extract_action_info(actions: list) -> tuple[str, dict]:
    if not actions:
        return "unknown", {}

    action = actions[0]
    if hasattr(action, "model_dump"):
        dumped = action.model_dump(exclude_none=True)
    elif hasattr(action, "__dict__"):
        dumped = {
            k: v for k, v in action.__dict__.items() if v is not None and not k.startswith("_")
        }
    else:
        return "unknown", {}

    for key, value in dumped.items():
        if value is None:
            continue
        if isinstance(value, dict):
            return key, value
        if hasattr(value, "model_dump"):
            return key, value.model_dump(exclude_none=True)
        if hasattr(value, "__dict__"):
            return key, {k: v for k, v in value.__dict__.items() if not k.startswith("_")}
        return key, {"value": str(value)}

    return "unknown", {}


def _build_llm(llm_provider: str, api_key: str, model: str | None):
    chat_module = importlib.import_module("browser_use.llm.openai.chat")
    ChatOpenAI = getattr(chat_module, "ChatOpenAI")

    if llm_provider == "nvidia":
        return ChatOpenAI(
            model=model or "meta/llama-4-maverick-17b-128e-instruct",
            api_key=api_key,
            base_url="https://integrate.api.nvidia.com/v1",
            timeout=300,
        )

    if llm_provider == "google":
        browser_use_mod = importlib.import_module("browser_use")
        ChatGoogle = getattr(browser_use_mod, "ChatGoogle")

        return ChatGoogle(
            model=model or "gemini-2.5-flash",
            api_key=api_key,
        )

    if llm_provider == "local":
        base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1")
        local_model = model or os.getenv("LOCAL_LLM_MODEL", "gemma4-vision-mygpu")
        local_api_key = api_key or os.getenv("LOCAL_LLM_API_KEY", "not-needed")
        return _OllamaChatOpenAI(
            model=local_model,
            api_key=local_api_key,
            base_url=base_url,
        )

    raise ValueError(f"Unknown LLM provider: {llm_provider!r}")


async def _get_screenshot(state: Any) -> str:
    import asyncio

    # Try direct screenshot attribute first (browser-use stores it here)
    for attr in ("screenshot", "screenshot_base64"):
        val = getattr(state, attr, None)
        if isinstance(val, str) and val:
            return val
        if isinstance(val, bytes) and val:
            return base64.b64encode(val).decode()

    # Try get_screenshot() method — may be async
    getter = getattr(state, "get_screenshot", None)
    if callable(getter):
        try:
            result = getter()
            if asyncio.iscoroutine(result):
                result = await result
            if isinstance(result, str) and result:
                return result
            if isinstance(result, bytes):
                return base64.b64encode(result).decode()
        except Exception:
            pass

    # Fallback: read from screenshot_path on disk
    path = getattr(state, "screenshot_path", None)
    if path and os.path.exists(str(path)):
        try:
            with open(str(path), "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception:
            pass

    return ""


def _png_dimensions_from_base64(screenshot_b64: str) -> tuple[int | None, int | None]:
    if not screenshot_b64:
        return None, None

    try:
        data = base64.b64decode(screenshot_b64, validate=False)
        if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
            width = struct.unpack(">I", data[16:20])[0]
            height = struct.unpack(">I", data[20:24])[0]
            if width > 0 and height > 0:
                return width, height
    except Exception:
        pass

    return None, None


def _to_percent(value: Any, axis_size: float | None) -> float | None:
    try:
        v = float(value)
    except Exception:
        return None
    if axis_size and axis_size > 0:
        p = (v / axis_size) * 100.0
    elif 0.0 <= v <= 1.0:
        p = v * 100.0
    elif 0.0 <= v <= 100.0:
        p = v  
    else:
        return None
    return max(0.0, min(100.0, p))

#---- try to detect the failure for the sankey diagram -----#
FAILURE_KEYWORDS = (
    "cannot continue", "unable to", "could not", "couldn't",
    "i give up", "i'll give up", "giving up", "have to give up",
    "not completed", "not fully completed", "task failed",
    "i cannot", "i can't", "unsuccessful",
)
 
def _looks_like_failure(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.lower()
    return any(k in lowered for k in FAILURE_KEYWORDS)
 


async def run_browser_agent(
    url: str,
    task: str,
    llm_provider: str,
    api_key: str,
    model: str | None,
    step_callback: Callable,
    status_callback: Callable,
    extend_system_message: str | None = None,
) -> dict:
    try:
        browser_use_mod = importlib.import_module("browser_use")
        profile_module = importlib.import_module("browser_use.browser.profile")
        Agent = getattr(browser_use_mod, "Agent")
        BrowserProfile = getattr(profile_module, "BrowserProfile")
    except ImportError as exc:
        raise ImportError("browser-use is not installed.") from exc

    await status_callback("Initializing...")
    llm = _build_llm(llm_provider, api_key, model)

    # browser_profile = BrowserProfile(
    #     headless=True,
    #     interaction_highlight_duration=0.35,
    # )

    browser = Browser(
        # cdp_url="ws://127.0.0.1:9222",
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            # Force light color scheme so websites render with their light-mode styles
            "--blink-settings=preferredColorScheme=1",
        ],
        window_size={'width': 1280, 'height': 800},
        device_scale_factor=1.0,
    )

    # Create a new folder to save conversation logs (based on timestamp)
    save_conversation_path = "/tmp/chat_logs/" + time.strftime("%Y.%m.%d-%H-%M-%S")
    os.makedirs(save_conversation_path, exist_ok=True)

    agent = Agent(
        task=f"Navigate to {url} and complete the following task: {task}",
        llm=llm,
        browser=browser,
        use_vision=True,
        use_judge=False,
        max_history_items=10,
        max_failures=5,
        llm_timeout=300,
        max_actions_per_step=1,
        save_conversation_path=save_conversation_path,
        extend_system_message=extend_system_message,
    )

    await status_callback("Agent is running... (this may take a few minutes)")

    steps: list[dict] = []
    history_items = []

    run_start = time.time()
    try:
        history = await agent.run(max_steps=50)
        await status_callback("Processing results...")
        history_items = history.history if hasattr(history, "history") else list(history)
    except Exception as e:
        await status_callback(f"Agent stopped early: {e}")
    run_end = time.time()

    n_items = sum(1 for item in history_items if hasattr(item, "model_output") and item.model_output is not None)

    _step_idx = 0
    for item in history_items:
        if not hasattr(item, "model_output") or item.model_output is None:
            continue

        brain = item.model_output.current_state
        actions = item.model_output.action or []
        action_type, action_details = _extract_action_info(actions)

        coords = None
        screenshot_b64 = await _get_screenshot(item.state)
        shot_w, shot_h = _png_dimensions_from_base64(screenshot_b64)

        interacted = getattr(item.state, "interacted_element", None)
        interacted_el = interacted[0] if isinstance(interacted, list) and interacted else None
        bounds = getattr(interacted_el, "bounds", None)

        if bounds is not None:
            x_pct = _to_percent(getattr(bounds, "x", None), shot_w)
            y_pct = _to_percent(getattr(bounds, "y", None), shot_h)
            w_pct = _to_percent(getattr(bounds, "width", None), shot_w)
            h_pct = _to_percent(getattr(bounds, "height", None), shot_h)
            if x_pct is not None and y_pct is not None and w_pct is not None and h_pct is not None:
                coords = ElementCoordinates(x=x_pct, y=y_pct, width=w_pct, height=h_pct)

        if coords is None:
            element_id = action_details.get("index") or action_details.get("element_id")
            if element_id is not None and item.state and hasattr(item.state, "items"):
                target_element = None
                if isinstance(item.state.items, dict):
                    target_element = item.state.items.get(element_id)

                if target_element:
                    x_pct = _to_percent(getattr(target_element, "x", None), shot_w)
                    y_pct = _to_percent(getattr(target_element, "y", None), shot_h)
                    w_pct = _to_percent(getattr(target_element, "width", 0.05), shot_w)
                    h_pct = _to_percent(getattr(target_element, "height", 0.05), shot_h)
                    if x_pct is not None and y_pct is not None and w_pct is not None and h_pct is not None:
                        coords = ElementCoordinates(x=x_pct, y=y_pct, width=w_pct, height=h_pct)
        
        element_text = None
        if interacted_el is not None:

            ## DEBUG##
            print("[DEBUG] interacted_el:", interacted_el.__dict__ if hasattr(interacted_el, '__dict__') 
                else interacted_el.model_dump() if hasattr(interacted_el, 'model_dump') 
                else dir(interacted_el))
            
            element_text = (
                getattr(interacted_el, "ax_name", None)
                or getattr(interacted_el, "text", None)
                or getattr(interacted_el, "aria_label", None)
                or getattr(interacted_el, "node_value", None)  # fallback for some elements
            )
            if element_text:
                action_details = {**action_details, "text": str(element_text).strip()[:200]}
                action_details = {**action_details, "text": str(element_text).strip()[:200]}
    

        # Distribute timestamps evenly across the actual wall-clock run duration
        # so per-step and total-time metrics are meaningful in the dashboard.
        frac = _step_idx / max(n_items - 1, 1) if n_items > 1 else 0.5
        step_ts = run_start + frac * (run_end - run_start)
        _step_idx += 1

        step = AgentStepData(
            step_number=len(steps) + 1,
            url=getattr(item.state, "url", "") or "",
            title=getattr(item.state, "title", "") or "",
            action_type=action_type,
            action_details=action_details,
            reasoning=getattr(brain, "evaluation_previous_goal", "") or "",
            thought=getattr(brain, "thinking", "") or "",
            next_goal=getattr(brain, "next_goal", "") or "",
            screenshot_base64=screenshot_b64,
            element_coordinates=coords,
            timestamp=step_ts,
        )

        step_dict = asdict(step)
        steps.append(step_dict)
        await step_callback(step_dict)

    
    # Determine outcome for the terminal step.
    if steps:
        terminal_idx = len(steps) - 1
        terminal_step = steps[terminal_idx]
        action_type = terminal_step.get("action_type") or ""
        action_details = terminal_step.get("action_details") or {}
        thought = terminal_step.get("thought") or ""
        next_goal = terminal_step.get("next_goal") or ""
 
        outcome: str | None = None
 
        # browser-use's done action: {"done": {"success": bool, "text": "..."}}
        # Our _extract_action_info already flattened that into:
        #   action_type == "done"
        #   action_details == {"success": ..., "text": "..."}  (or similar)
        if action_type == "done":
            success_flag = action_details.get("success")
            if success_flag is True:
                outcome = "success"
            elif success_flag is False:
                outcome = "failed"
            else:
                # Done emitted but no explicit success field — fall back to
                # keyword scan of the surrounding text.
                blob = " ".join(filter(None, [
                    str(action_details.get("text") or ""),
                    thought,
                    next_goal,
                ]))
                outcome = "failed" if _looks_like_failure(blob) else "success"
        else:
            # No `done` action at all → agent ran out of steps. We label this
            # `incomplete` unless the LLM clearly signaled failure in the
            # last step's reasoning.
            blob = " ".join(filter(None, [thought, next_goal]))
            outcome = "failed" if _looks_like_failure(blob) else "incomplete"
 
        steps[terminal_idx]["outcome"] = outcome
 
    return {"steps": steps, "total_steps": len(steps), "success": True}
 


