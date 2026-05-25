import json
import os
import re

from db.session import SessionLocal
from models.journey import Journey

ANNOTATE_TYPES = {"extract", "extract_content", "done", "read_text", "get_text"}


def annotate_attention_background(journey_id: int) -> None:
    """Background task: call local VLM to locate where each extract/done step's observation is on the screenshot."""
    db = SessionLocal()
    try:
        journey = db.get(Journey, journey_id)
        if not journey:
            return
        steps = json.loads(journey.steps)
        changed = False

        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://host.docker.internal:11434/v1"),
                api_key=os.getenv("LOCAL_LLM_API_KEY", "not-needed"),
            )
        except Exception as e:
            print(f"[attention] cannot init VLM client: {e}", flush=True)
            return

        model = os.getenv("LOCAL_LLM_MODEL", "gemma4-vision-mygpu")

        for step in steps:
            if step.get("action_type") not in ANNOTATE_TYPES:
                continue
            if step.get("attention_coordinates"):
                continue
            img = step.get("screenshot_base64", "")
            if not img:
                continue
            thought = (step.get("thought") or step.get("reasoning") or "").strip()
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
                                "text": (
                                    f'An AI agent looking at this webpage wrote:\n"{thought}"\n\n'
                                    "Point to the region of the screenshot this text refers to.\n"
                                    'Reply ONLY with JSON: {"x": <0-100>, "y": <0-100>}\n'
                                    "(x=0 left, x=100 right, y=0 top, y=100 bottom)"
                                ),
                            },
                        ],
                    }],
                    max_tokens=64,
                )
                text = resp.choices[0].message.content.strip()
                m = re.search(r'\{[^}]+\}', text)
                if m:
                    coords = json.loads(m.group())
                    x = max(2.0, min(98.0, float(coords["x"])))
                    y = max(2.0, min(98.0, float(coords["y"])))
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
