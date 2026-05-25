import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from api.deps import get_db
from models.event import Event
from models.screenshot import Screenshot
from services.screenshot import save_screenshot

router = APIRouter(prefix="/api", tags=["Screenshots"])
v1_router = APIRouter(prefix="/v1", tags=["Screenshots"])


@router.post("/screenshot", status_code=201)
async def upload_screenshot(
    session_id: str = Form(...),
    site_id: str = Form(...),
    path: str = Form(...),
    trigger: str = Form("pageview"),
    action_id: str | None = Form(None),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    image_bytes = await image.read()
    try:
        save_screenshot(db, session_id, site_id, path, trigger, image_bytes, action_id)
    except Exception:
        pass
    return {"ok": True}


@v1_router.get("/sessions/{session_id}/screenshots")
def list_screenshots(session_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(Screenshot)
        .filter(Screenshot.session_id == session_id)
        .order_by(Screenshot.created_at)
        .all()
    )
    return [
        {
            "id": r.id,
            "path": r.path,
            "trigger": r.trigger,
            "action_id": r.action_id,
            "created_at_ms": int(r.created_at.timestamp() * 1000) if r.created_at else None,
            "ready": r.file_path is not None,
        }
        for r in rows
    ]


@v1_router.get("/journeys/{journey_id}/screenshots")
def list_journey_screenshots(journey_id: int, db: Session = Depends(get_db)):
    session_id = f"browseruse:{journey_id}"
    rows = (
        db.query(Screenshot)
        .filter(Screenshot.session_id == session_id)
        .order_by(Screenshot.created_at)
        .all()
    )
    return [
        {
            "id": r.id,
            "path": r.path,
            "trigger": r.trigger,
            "action_id": r.action_id,
            "created_at_ms": int(r.created_at.timestamp() * 1000) if r.created_at else None,
            "ready": r.file_path is not None,
        }
        for r in rows
    ]


@v1_router.get("/screenshots/{screenshot_id}/image")
def get_screenshot_image(screenshot_id: int, db: Session = Depends(get_db)):
    sc = db.get(Screenshot, screenshot_id)
    if not sc or not sc.file_path:
        raise HTTPException(status_code=404, detail="Screenshot not found or not ready")
    return FileResponse(sc.file_path, media_type="image/png")


@v1_router.get("/screenshots/{screenshot_id}/events")
def get_events_between_screenshots(screenshot_id: int, db: Session = Depends(get_db)):
    sc = db.get(Screenshot, screenshot_id)
    if not sc:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    next_sc = (
        db.query(Screenshot)
        .filter(
            Screenshot.session_id == sc.session_id,
            Screenshot.created_at > sc.created_at,
        )
        .order_by(Screenshot.created_at)
        .first()
    )

    query = db.query(Event).filter(
        Event.session_id == sc.session_id,
        Event.created_at >= sc.created_at,
    )
    if next_sc:
        query = query.filter(Event.created_at < next_sc.created_at)

    return [
        {
            "id": e.id,
            "type": e.type,
            "path": e.path,
            "timestamp": e.timestamp,
            "created_at": e.created_at,
            "data": json.loads(e.data) if e.data else None,
        }
        for e in query.order_by(Event.created_at).all()
    ]
