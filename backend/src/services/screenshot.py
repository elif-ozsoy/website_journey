from sqlalchemy.orm import Session as DBSession

from models.screenshot import Screenshot


def save_screenshot(
    db: DBSession,
    session_id: str,
    site_id: str,
    path: str,
    trigger: str,
    image_bytes: bytes,
    action_id: str | None = None,
) -> Screenshot:
    sc = Screenshot(
        session_id=session_id,
        site_id=site_id,
        path=path,
        trigger=trigger,
        action_id=action_id,
        data=image_bytes,
    )
    db.add(sc)
    db.commit()
    db.refresh(sc)
    return sc
