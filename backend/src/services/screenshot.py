import os
from pathlib import Path

from sqlalchemy.orm import Session as DBSession

from models.screenshot import Screenshot

SCREENSHOTS_DIR = Path(os.getenv("SCREENSHOTS_DIR", "/screenshots"))


def save_screenshot(
    db: DBSession,
    session_id: str,
    site_id: str,
    path: str,
    trigger: str,
    image_bytes: bytes,
    action_id: str | None = None,
) -> Screenshot:
    sc = Screenshot(session_id=session_id, site_id=site_id, path=path, trigger=trigger, action_id=action_id)
    db.add(sc)
    db.commit()
    db.refresh(sc)

    dest_dir = SCREENSHOTS_DIR / session_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = str(dest_dir / f"{sc.id}.png")

    with open(file_path, "wb") as f:
        f.write(image_bytes)

    sc.file_path = file_path
    db.commit()
    return sc
