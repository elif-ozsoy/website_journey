import json
import logging

from core.config import settings
from db.session import SessionLocal
from models.journey import Journey

log = logging.getLogger(__name__)

_FOCUS_AREA_DESCRIPTIONS: dict[str, str] = {
    'speed': 'Speed — was the task completed efficiently? Note unnecessary detours, repeated actions, or time wasted on slow interactions.',
    'confidence': 'Confidence — did the navigator hesitate, backtrack, or show uncertainty? Look for signs of confusion about where to go next.',
    'confusion': 'Confusion — were any UI elements misunderstood or misleading? Note unexpected clicks, mis-taps, or failed attempts.',
    'accessibility': 'Accessibility — were there barriers for users with disabilities? Note small touch targets, missing labels, or keyboard navigation issues.',
    'discoverability': 'Discoverability — were key features or content hard to find? Note how many steps were needed to locate the target.',
    'errors': 'Errors — did the navigator encounter errors, dead ends, 404s, or broken interactions?',
}


def _build_system_prompt(is_agent: bool, focus_areas: list[str] | None) -> str:
    source = 'an AI agent' if is_agent else 'a real user'
    prompt = (
        f'You are a UX analysis expert producing actionable feedback for a UX designer. '
        f'You will receive a structured log of {source} navigating a website to complete a task. '
        f'Analyse the journey and respond ONLY with a JSON object (no markdown, no explanation) '
        f'with these exact keys:\n\n'
        '{\n'
        '  "summary": "2-3 sentence plain-English summary of what happened and whether the task was completed",\n'
        '  "success": true | false | null,\n'
        '  "difficulty": "low" | "medium" | "high" | null,\n'
        '  "key_observations": ["observation 1", "observation 2", ...],\n'
        '  "pain_points": ["pain point 1", ...],\n'
        '  "recommendations": ["actionable UX recommendation 1", ...]\n'
        '}'
    )

    if focus_areas:
        area_lines = '\n'.join(
            f'- {_FOCUS_AREA_DESCRIPTIONS[a]}'
            for a in focus_areas
            if a in _FOCUS_AREA_DESCRIPTIONS
        )
        if area_lines:
            prompt += (
                '\n\nThe task has the following focus areas. '
                'Give dedicated, specific feedback on each one across your key_observations, pain_points, and recommendations:\n'
                + area_lines
            )

    prompt += (
        '\n\nYour recommendations must be concrete and actionable — '
        'written for a UX designer who will use them to directly improve the interface.'
    )
    return prompt


def _format_steps(task_title: str, site_url: str, steps: list[dict]) -> str:
    lines = [f'Task: {task_title}', f'Site: {site_url}', f'Steps ({len(steps)} total):']
    for s in steps:
        screenshot = s.pop('screenshot_base64', None)
        s.pop('screenshot', None)
        lines.append(json.dumps(s))
        if screenshot:
            s['screenshot_base64'] = screenshot
    return '\n'.join(lines)


def _call_llm(
    task_title: str,
    site_url: str,
    steps: list[dict],
    is_agent: bool,
    focus_areas: list[str] | None,
    api_key: str = "",
    llm_provider: str = "",
) -> str:
    system_prompt = _build_system_prompt(is_agent, focus_areas)
    user_content = _format_steps(task_title, site_url, steps)
    messages = [{'role': 'user', 'content': user_content}]

    # Per-request key takes priority over env vars
    if api_key and llm_provider == "google":
        from openai import OpenAI
        client = OpenAI(
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        resp = client.chat.completions.create(
            model="gemini-2.0-flash",
            max_tokens=1024,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        return resp.choices[0].message.content
    elif api_key and llm_provider == "nvidia":
        from openai import OpenAI
        client = OpenAI(
            api_key=api_key,
            base_url="https://integrate.api.nvidia.com/v1",
        )
        resp = client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            max_tokens=1024,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        return resp.choices[0].message.content
    elif settings.anthropic_api_key:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        )
        return msg.content[0].text
    elif settings.nvidia_api_key:
        from openai import OpenAI
        client = OpenAI(
            api_key=settings.nvidia_api_key,
            base_url="https://integrate.api.nvidia.com/v1",
        )
        resp = client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            max_tokens=1024,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        return resp.choices[0].message.content
    else:
        from openai import OpenAI
        client = OpenAI(
            api_key=settings.google_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        resp = client.chat.completions.create(
            model="gemini-2.0-flash",
            max_tokens=1024,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        return resp.choices[0].message.content


def analyze_journey_background(
    journey_id: int,
    task_title: str,
    site_url: str,
    steps_json: str,
    is_agent: bool = True,
    focus_areas: list[str] | None = None,
    api_key: str = "",
    llm_provider: str = "",
) -> None:
    """Synchronous background task — called by FastAPI BackgroundTasks."""
    has_key = api_key or settings.anthropic_api_key or settings.nvidia_api_key or settings.google_api_key
    if not has_key:
        log.warning('No LLM API key configured — skipping journey analysis')
        return

    try:
        steps: list[dict] = json.loads(steps_json)
        result_text = _call_llm(task_title, site_url, steps, is_agent, focus_areas, api_key, llm_provider)
        json.loads(result_text)  # validate JSON
        analysis_json = result_text
    except Exception as exc:
        log.error('Journey analysis failed for journey %s: %s', journey_id, exc)
        analysis_json = json.dumps({'error': str(exc)})

    db = SessionLocal()
    try:
        journey = db.get(Journey, journey_id)
        if journey:
            journey.llm_analysis = analysis_json
            db.commit()
    finally:
        db.close()
