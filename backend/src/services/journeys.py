import base64
import json
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from core.config import settings
from models.journey import Journey
from models.screenshot import Screenshot
from models.site import Site
from models.task import Task
from services.embeddings import journey_embedding
from services.screenshot import save_screenshot


def upsert_journey(
    db: Session,
    site_id: str,
    task_title: str,
    steps: list[dict],
    policy_trace: list[dict] | None = None,
    user_id: str | None = None,
    task_id: int | None = None,
    source: str = 'agent',
    is_agent: bool = True,
) -> Journey:
    """Save or replace the journey for (site_id, task_title, user_id, source).

    If a journey already exists for that combination it is overwritten so each
    user always has at most one journey per task per project per source.
    """
    existing = None
    if not is_agent: #the same agent tasks overwrite each other 
        existing = (
            db.query(Journey)
            .filter(
                Journey.site_id == site_id,
                Journey.task_title == task_title,
                Journey.user_id == user_id,
                Journey.source == source,
                Journey.is_agent == is_agent,
            )
            .first()
        )
        

    now = datetime.now(timezone.utc)
    steps_json = json.dumps(steps)
    policy_trace_json = json.dumps(policy_trace) if policy_trace is not None else None
    embedding_json = json.dumps(journey_embedding(steps))

    if existing:
        existing.task_id = task_id
        existing.total_steps = len(steps)
        existing.steps = steps_json
        existing.policy_trace = policy_trace_json
        existing.is_agent = is_agent
        existing.embedding = embedding_json
        existing.completed_at = now
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return existing

    journey = Journey(
        site_id=site_id,
        task_id=task_id,
        user_id=user_id,
        task_title=task_title,
        total_steps=len(steps),
        steps=steps_json,
        policy_trace=policy_trace_json,
        source=source,
        is_agent=is_agent,
        embedding=embedding_json,
        completed_at=now,
    )
    db.add(journey)
    db.commit()
    db.refresh(journey)
    return journey

def _read_human_task_outcome(db, session_id: str, task_title: str) -> str | None:
    """Look up the latest task_outcome event for this (session, task) pair.
 
    Returns 'success' / 'failed' / None. Multiple rows can exist if the user
    submitted the finished page more than once — the most recent wins.
    """
    import json as _json
    from models.event import Event
 
    if not session_id or not task_title:
        return None
 
    rows = (
        db.query(Event)
        .filter(
            Event.session_id == session_id,
            Event.type == "task_outcome",
        )
        .order_by(Event.created_at.desc())
        .all()
    )
    for r in rows:
        try:
            data = _json.loads(r.data) if r.data else {}
        except Exception:
            continue
        if data.get("task_title") != task_title:
            continue
        outcome = data.get("outcome")
        if outcome in ("success", "failed"):
            return outcome
    return None


def get_journeys_for_site(
    db: Session,
    site_id: str,
    user_id: str | None = None,
    source: str | None = None,
) -> list[Journey]:
    """Get journeys for a site. If user_id provided, only return that user's journeys."""
    q = db.query(Journey).filter(Journey.site_id == site_id)
    if user_id is not None:
        q = q.filter(Journey.user_id == user_id)
    if source is not None:
        q = q.filter(Journey.source == source)
    return q.order_by(Journey.completed_at.desc()).all()


def get_projects_for_user(db: Session, user_id: str) -> list[dict]:
    """Return all sites owned by user with their journeys."""
    sites = db.query(Site).filter(Site.user_id == user_id).all()
    result = []
    for site in sites:
        journeys = (
            db.query(Journey)
            .filter(Journey.site_id == site.id, Journey.user_id == user_id)
            .order_by(Journey.completed_at.desc())
            .all()
        )
        tasks = db.query(Task).filter(Task.site_id == site.id).order_by(Task.order_index).all()
        result.append(
            {
                "site_id": site.id,
                "slug": site.slug,
                "tester_link": f"{settings.proxy_base_url}/intro/{site.slug}",
                "label": site.label,
                "target_url": site.target_url,
                "created_at": site.created_at.isoformat(),
                "tasks": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "description": t.description,
                        "order_index": t.order_index,
                    }
                    for t in tasks
                ],
                "journeys": [
                    {
                        "id": j.id,
                        "site_id": j.site_id,
                        "task_id": j.task_id,
                        "user_id": j.user_id,
                        "task_title": j.task_title,
                        "total_steps": j.total_steps,
                        "steps": [{k: v for k, v in s.items() if k != "screenshot_base64"} for s in json.loads(j.steps)],
                        "policy_trace": json.loads(j.policy_trace) if j.policy_trace else None,
                        "llm_analysis": j.llm_analysis,
                        "source": getattr(j, 'source', 'agent'),
                        "is_agent": j.is_agent,
                        "embedding": json.loads(j.embedding) if j.embedding else None,
                        "completed_at": j.completed_at.isoformat(),
                        "updated_at": j.updated_at.isoformat(),
                    }
                    for j in journeys
                ],
            }
        )
    return result


def browseruse_session_id(journey_id: int) -> str:
    return f"browseruse:{journey_id}"


def _step_path(step: dict) -> str:
    raw_url = str(step.get("url") or "")
    if not raw_url:
        return "/"
    try:
        parsed = urlparse(raw_url)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        return path
    except Exception:
        return raw_url


def persist_browseruse_screenshots(
    db: Session,
    journey: Journey,
    site_id: str,
    steps: list[dict],
) -> int:
    session_id = browseruse_session_id(journey.id)

    rows = db.query(Screenshot).filter(Screenshot.session_id == session_id).all()
    for row in rows:
        if row.file_path:
            try:
                import os

                if os.path.exists(row.file_path):
                    os.remove(row.file_path)
            except Exception:
                pass
        db.delete(row)
    db.commit()

    saved = 0
    for step in steps:
        screenshot_b64 = str(step.get("screenshot_base64") or "").strip()
        if not screenshot_b64:
            continue
        try:
            image_bytes = base64.b64decode(screenshot_b64)
        except Exception:
            continue

        save_screenshot(
            db=db,
            session_id=session_id,
            site_id=site_id,
            path=_step_path(step),
            trigger=str(step.get("action_type") or f"step-{step.get('step_number', saved + 1)}"),
            image_bytes=image_bytes,
            action_id=str(step.get("step_number", saved + 1)),
        )
        saved += 1

    return saved