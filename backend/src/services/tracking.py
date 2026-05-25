from sqlalchemy.orm import Session

from models.event import Event
from models.session import TrackerSession
from schemas.tracking import EventBatch, SessionCreate


def create_session(db: Session, data: SessionCreate) -> None:
    if db.get(TrackerSession, data.session_id):
        return
    db.add(TrackerSession(
        id=data.session_id,
        site_id=data.site_id,
        user_agent=data.user_agent,
        viewport_w=data.viewport_w,
        viewport_h=data.viewport_h,
        referrer=data.referrer,
        device_type=data.device_type,
    ))
    db.commit()


def batch_insert_events(db: Session, batch: EventBatch) -> None:
    # Auto-register any sessions referenced by events that aren't in the DB yet.
    # This self-heals after a DB reset when browsers still have old sessionStorage IDs.
    seen: set[str] = set()
    for e in batch.events:
        sid = e.session_id
        if sid and e.site_id and sid not in seen:
            seen.add(sid)
            if not db.get(TrackerSession, sid):
                db.add(TrackerSession(id=sid, site_id=e.site_id))
    db.add_all([
        Event.from_dict(e.model_dump()) for e in batch.events
    ])
    db.commit()
