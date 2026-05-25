import json
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import services.journeys as svc
from api.deps import get_current_user_optional, get_db
from models.journey import Journey
from models.user import User
from schemas.journeys import JourneyResponse, JourneySaveRequest, ProjectWithJourneys
from services.analysis import analyze_journey_background
from services.embeddings import cosine_similarity, similarity_matrix

router = APIRouter(tags=["Journeys"])


def _strip_screenshots(steps: list[dict], screenshot_urls: dict[str, str] | None = None) -> list[dict]:
    """Remove screenshot_base64 blobs and inject screenshot_url from the screenshots table."""
    result = []
    for s in steps:
        row = {k: v for k, v in s.items() if k != "screenshot_base64"}
        if screenshot_urls and not row.get("screenshot_url"):
            step_num = str(s.get("step_number", ""))
            if step_num in screenshot_urls:
                row["screenshot_url"] = screenshot_urls[step_num]
        result.append(row)
    return result


def _journey_to_response(j: Journey, strip_screenshots: bool = False, db: Session | None = None) -> JourneyResponse:
    steps = json.loads(j.steps)
    if strip_screenshots:
        screenshot_urls: dict[str, str] | None = None
        if db is not None:
            from models.screenshot import Screenshot
            session_id = f"browseruse:{j.id}"
            rows = db.query(Screenshot).filter(Screenshot.session_id == session_id).all()
            screenshot_urls = {
                r.action_id: f"/api/v1/screenshots/{r.id}/image"
                for r in rows if r.action_id and r.file_path
            }
        steps = _strip_screenshots(steps, screenshot_urls)
    return JourneyResponse(
        id=j.id,
        site_id=j.site_id,
        task_id=j.task_id,
        user_id=j.user_id,
        task_title=j.task_title,
        total_steps=j.total_steps,
        steps=steps,
        policy_trace=json.loads(j.policy_trace) if j.policy_trace else None,
        llm_analysis=j.llm_analysis,
        source=j.source,
        is_agent=j.is_agent,
        embedding=json.loads(j.embedding) if j.embedding else None,
        completed_at=j.completed_at,
        updated_at=j.updated_at,
    )


@router.post("/journeys", response_model=JourneyResponse, status_code=201)
def save_journey(
    body: JourneySaveRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    user_id = current_user.id if current_user else None
    journey = svc.upsert_journey(
        db,
        site_id=body.site_id,
        task_title=body.task_title,
        steps=body.steps,
        policy_trace=body.policy_trace,
        user_id=user_id,
        task_id=body.task_id,
    )
    # Fire-and-forget LLM analysis
    site = db.get(type(journey).__table__.c, journey.site_id) if False else None  # lazy
    from models.site import Site  # avoid circular at module level
    site_obj = db.get(Site, journey.site_id)
    site_url = site_obj.target_url if site_obj else ""
    background_tasks.add_task(
        analyze_journey_background,
        journey.id,
        journey.task_title,
        site_url,
        journey.steps,
        body.is_agent,
        body.focus_areas,
    )
    return _journey_to_response(journey)


@router.get("/journeys/{journey_id}", response_model=JourneyResponse)
def get_journey(
    journey_id: int,
    db: Session = Depends(get_db),
):
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found")
    return _journey_to_response(journey)


@router.post("/journeys/{journey_id}/analyze", response_model=dict)
def trigger_analysis(
    journey_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found")
    from models.site import Site
    site_obj = db.get(Site, journey.site_id)
    site_url = site_obj.target_url if site_obj else ""
    background_tasks.add_task(
        analyze_journey_background,
        journey.id,
        journey.task_title,
        site_url,
        journey.steps,
    )
    return {"status": "queued"}


@router.get("/sites/{site_id}/journeys", response_model=list[JourneyResponse])
def list_site_journeys(
    site_id: str,
    source: str | None = None,
    db: Session = Depends(get_db),
):
    journeys = svc.get_journeys_for_site(db, site_id, source=source)
    return [_journey_to_response(j, strip_screenshots=True, db=db) for j in journeys]


@router.get("/users/{user_id}/projects", response_model=list[ProjectWithJourneys])
def get_user_projects(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional),
):
    if current_user is None or current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return svc.get_projects_for_user(db, user_id)


# ─── Similarity endpoint ──────────────────────────────────────────────────────

class JourneySimilarityItem(BaseModel):
    agent_journey_id: int
    human_journey_id: int
    task_title: str
    similarity: float


@router.get("/sites/{site_id}/similarity", response_model=list[JourneySimilarityItem])
def get_site_similarity(
    site_id: str,
    task_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Compute cosine similarity between every (agent journey, human journey) pair
    for the site, optionally filtered to a single task.
    """
    q = db.query(Journey).filter(Journey.site_id == site_id, Journey.embedding.isnot(None))
    if task_id is not None:
        q = q.filter(Journey.task_id == task_id)
    all_journeys = q.all()

    agent_js = [j for j in all_journeys if j.is_agent is True]
    human_js = [j for j in all_journeys if j.is_agent is False]

    results = []
    for aj in agent_js:
        a_emb = json.loads(aj.embedding)
        for hj in human_js:
            if aj.task_title != hj.task_title:
                continue
            h_emb = json.loads(hj.embedding)
            results.append(JourneySimilarityItem(
                agent_journey_id=aj.id,
                human_journey_id=hj.id,
                task_title=aj.task_title,
                similarity=cosine_similarity(a_emb, h_emb),
            ))

    return sorted(results, key=lambda x: -x.similarity)


# ─── Comparative analysis endpoint ───────────────────────────────────────────

class ComparativeAnalysisRequest(BaseModel):
    task_ids: Optional[List[int]] = None  # None = all tasks
    version_id: Optional[str] = "v1"


@router.get("/sites/{site_id}/comparative-analysis")
def get_comparative_analysis(
    site_id: str,
    version_id: str = "v1",
    db: Session = Depends(get_db),
):
    """Return a previously stored comparative analysis result for this site+version."""
    from models.site_analysis import SiteAnalysis

    record = (
        db.query(SiteAnalysis)
        .filter(SiteAnalysis.site_id == site_id, SiteAnalysis.version_id == version_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="No stored analysis found")
    return json.loads(record.analysis_json)


@router.post("/sites/{site_id}/comparative-analysis")
def comparative_analysis(
    site_id: str,
    body: ComparativeAnalysisRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Call Claude to compare all agent journeys against all human journeys for this site.
    Human journeys come from Journey rows (is_agent=False) OR from raw TrackerSession events.
    Saves the result to the DB so it can be retrieved without recomputing.
    """
    from models.site import Site
    from models.session import TrackerSession
    from models.event import Event as TrackerEvent
    from models.task import Task as TaskModel
    from models.site_analysis import SiteAnalysis
    from services.comparative_analysis import run_comparative_analysis

    site_obj = db.get(Site, site_id)
    if not site_obj:
        raise HTTPException(status_code=404, detail="Site not found")

    # ── Agent journeys from Journey table ─────────────────────────────────────
    q = db.query(Journey).filter(Journey.site_id == site_id)
    if body.task_ids:
        q = q.filter(Journey.task_id.in_(body.task_ids))
    db_journeys = q.all()

    journey_dicts: list[dict] = [
        {
            "task_title": j.task_title,
            "is_agent": j.is_agent,
            "steps": json.loads(j.steps),
            "embedding": json.loads(j.embedding) if j.embedding else None,
            "journey_id": j.id,
        }
        for j in db_journeys
    ]

    # ── Human journeys from TrackerSession + Event tables ─────────────────────
    # Only include human Journey rows that haven't already been added above
    human_journey_ids = {j.id for j in db_journeys if j.is_agent is False}

    # Build a fallback task title from site tasks (first task title, or generic)
    site_tasks = db.query(TaskModel).filter(TaskModel.site_id == site_id).all()
    default_task_title = site_tasks[0].title if site_tasks else "General navigation"

    sessions = (
        db.query(TrackerSession)
        .filter(TrackerSession.site_id == site_id)
        .all()
    )
    noisy = {"mousemove", "pointermove", "mouseover", "mouseenter", "mouseleave", "mouseout"}
    for sess in sessions:
        events = (
            db.query(TrackerEvent)
            .filter(TrackerEvent.session_id == sess.id)
            .order_by(TrackerEvent.timestamp)
            .limit(200)
            .all()
        )
        filtered = [e for e in events if e.type not in noisy]
        if not filtered:
            continue

        def _map_action(t: str) -> str:
            t = t.lower()
            if "click" in t: return "click_element"
            if any(k in t for k in ("input", "change", "submit", "key")): return "input_text"
            if "scroll" in t: return "scroll"
            if any(k in t for k in ("navigate", "route", "page")): return "go_to_url"
            return "unknown"

        steps = []
        for i, e in enumerate(filtered, 1):
            try:
                data = json.loads(e.data) if e.data else {}
            except Exception:
                data = {}
            steps.append({
                "step_number": i,
                "url": e.path or site_obj.target_url,
                "action_type": _map_action(e.type),
                "action_details": data,
                "thought": data.get("text", ""),
                "timestamp": e.timestamp,
            })

        journey_dicts.append({
            "task_title": default_task_title,
            "is_agent": False,
            "steps": steps,
        })

    if not journey_dicts:
        raise HTTPException(status_code=404, detail="No journeys found for this site")

    try:
        anthropic_key = request.headers.get("x-anthropic-key") or None
        agent_api_key = request.headers.get("x-agent-api-key") or None
        agent_provider = request.headers.get("x-agent-provider") or None
        result = run_comparative_analysis(
            site_obj.target_url,
            journey_dicts,
            api_key=anthropic_key,
            agent_api_key=agent_api_key,
            agent_provider=agent_provider,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # ── Persist result so it isn't recomputed on every page visit ────────────
    version_id = body.version_id or "v1"
    try:
        existing = (
            db.query(SiteAnalysis)
            .filter(SiteAnalysis.site_id == site_id, SiteAnalysis.version_id == version_id)
            .first()
        )
        result_json = json.dumps(result)
        if existing:
            existing.analysis_json = result_json
        else:
            db.add(SiteAnalysis(site_id=site_id, version_id=version_id, analysis_json=result_json))
        db.commit()
    except Exception:
        db.rollback()  # non-fatal — still return the result

    return result
