from sqlalchemy.orm import Session

from models.event import Event
from models.session import TrackerSession


def list_sessions(
    db: Session,
    site_id: str,
    limit: int = 100,
    offset: int = 0,
) -> list[TrackerSession]:
    return (
        db.query(TrackerSession)
        .filter(TrackerSession.site_id == site_id)
        .order_by(TrackerSession.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_session(db: Session, session_id: str) -> TrackerSession | None:
    return db.get(TrackerSession, session_id)


def list_events(
    db: Session,
    site_id: str | None = None,
    session_id: str | None = None,
    event_type: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> list[Event]:
    query = db.query(Event)
    if site_id is not None:
        query = query.filter(Event.site_id == site_id)
    if session_id is not None:
        query = query.filter(Event.session_id == session_id)
    if event_type is not None:
        query = query.filter(Event.type == event_type)
    return query.order_by(Event.timestamp.asc()).offset(offset).limit(limit).all()
