from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from models.site import Site
from schemas.analytics import EventResponse, SessionResponse
from services import analytics as svc

router = APIRouter(tags=["Analytics"])


def _resolve_site_id(db: Session, site_id_or_slug: str) -> str:
    """Accept either a site id or slug and return the canonical site id."""
    site = db.query(Site).filter(
        (Site.id == site_id_or_slug) | (Site.slug == site_id_or_slug)
    ).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site.id


@router.get("/sites/{site_id}/sessions", response_model=list[SessionResponse])
def list_sessions(
    site_id: str,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    resolved = _resolve_site_id(db, site_id)
    return svc.list_sessions(db, resolved, limit=limit, offset=offset)


@router.get("/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = svc.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/sites/{site_id}/events", response_model=list[EventResponse])
def list_events_by_site(
    site_id: str,
    event_type: str | None = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    resolved = _resolve_site_id(db, site_id)
    return svc.list_events(db, site_id=resolved, event_type=event_type, limit=limit, offset=offset)


@router.get("/sessions/{session_id}/events", response_model=list[EventResponse])
def list_events_by_session(
    session_id: str,
    event_type: str | None = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    return svc.list_events(db, session_id=session_id, event_type=event_type, limit=limit, offset=offset)
