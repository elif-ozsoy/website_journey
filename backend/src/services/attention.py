import json
import os
import re

from db.session import SessionLocal
from models.journey import Journey

ANNOTATE_TYPES = {"extract", "extract_content", "done", "read_text", "get_text"}

PROMPT_TEMPLATE = """\
You are analyzing a screenshot of a webpage. An AI agent has just finished a step and written the following:

THOUGHT: {thought}

Your job: identify the CENTER of the specific area on the screenshot that the agent is referring to \
(e.g. the address block, the teacher's name, the table row, the text paragraph it read).

Rules:
- x is a percentage of image width: 0 = left edge, 100 = right edge
- y is a percentage of image height: 0 = top edge, 100 = bottom edge
- Point to the CENTER of the relevant element or text block, not the corner
- If the agent mentions a specific visible item (name, address, table, heading), find it and point to its center
- Do NOT default to (0,0) or the top-left — only use coordinates where the content actually appears

Reply with ONLY a JSON object, nothing else:
{{"x": <number 0-100>, "y": <number 0-100>}}"""


def annotate_attention_background(journey_id: int, api_key: str = "", llm_provider: str = "local") -> None:
    """Background task: call VLM to locate where each extract/done step's observation is on the screenshot."""
    db = SessionLocal()
    try:
        journey = db.get(Journey, journey_id)
        if not journey:
            return
        steps = json.loads(journey.steps)
        changed = False

        try:
            from openai import OpenAI
            if llm_provider == "nvidia" and api_key:
                client = OpenAI(
                    base_url="https://integrate.api.nvidia.com/v1",
                    api_key=api_key,
                )
                model = "meta/llama-4-maverick-17b-128e-instruct"
            else:
                client = OpenAI(
                    base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1"),
                    api_key=os.getenv("LOCAL_LLM_API_KEY", "not-needed"),
                )
                model = os.getenv("LOCAL_LLM_MODEL", "gemma4-vision-mygpu")
        except Exception as e:
            print(f"[attention] cannot init VLM client: {e}", flush=True)
            return

        for step in steps:
            if step.get("action_type") not in ANNOTATE_TYPES:
                continue
            if step.get("attention_coordinates"):
                continue
            img = step.get("screenshot_base64", "")
            if not img:
                continue

            # Build context from all available reasoning fields
            context_parts = [
                step.get("thought") or "",
                step.get("reasoning") or "",
                step.get("next_goal") or "",
            ]
            thought = " | ".join(p.strip() for p in context_parts if p.strip())
            if len(thought) < 10:
                continue

            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{img}"},
                            },
                            {
                                "type": "text",
                                "text": PROMPT_TEMPLATE.format(thought=thought),
                            },
                        ],
                    }],
                    max_tokens=64,
                )
                text = resp.choices[0].message.content.strip()
                print(f"[attention] journey={journey_id} step={step.get('step_number')} raw={text[:120]}", flush=True)
                m = re.search(r'\{[^}]+\}', text)
                if not m:
                    print(f"[attention] journey={journey_id} step={step.get('step_number')} no JSON found in response", flush=True)
                    continue
                coords = json.loads(m.group())
                x = float(coords["x"])
                y = float(coords["y"])

                # Discard clearly wrong responses (model defaulted to 0,0)
                if x <= 1.0 and y <= 1.0:
                    print(f"[attention] journey={journey_id} step={step.get('step_number')} skipped (0,0 default)", flush=True)
                    continue

                x = max(2.0, min(98.0, x))
                y = max(2.0, min(98.0, y))
                step["attention_coordinates"] = {"x": x, "y": y}
                changed = True
                print(f"[attention] journey={journey_id} step={step.get('step_number')} -> ({x:.1f}, {y:.1f})", flush=True)
            except Exception as e:
                print(f"[attention] journey={journey_id} step={step.get('step_number')} err={e}", flush=True)

        if changed:
            journey.steps = json.dumps(steps)
            db.commit()
    finally:
        db.close()
