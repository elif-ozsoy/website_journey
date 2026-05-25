import secrets
import string

from sqlalchemy.orm import Session

from core.config import settings
from models.site import Site


def _generate_id(length: int) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _site_query(db: Session, target_url: str, label: str | None):
    query = db.query(Site).filter(Site.target_url == target_url)
    if label is not None:
        query = query.filter(Site.label == label)
    else:
        query = query.filter(Site.label.is_(None))
    return query


def generate_tester_link(
    db: Session, target_url: str, label: str | None = None, user_id: str | None = None
) -> dict:
    if _site_query(db, target_url, label).first() is not None:
        raise ValueError("A tester link for this URL/label combination already exists")

    site = Site(
        id=_generate_id(16),
        slug=_generate_id(8),
        target_url=target_url,
        label=label,
        user_id=user_id,
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    proxy_url = f"{settings.proxy_base_url}/intro/{site.slug}"
    return {"tester_link": proxy_url, "site_id": site.id}


def get_tester_link(db: Session, target_url: str, label: str | None = None) -> dict | None:
    site = _site_query(db, target_url, label).first()
    if site is None:
        return None
    proxy_url = f"{settings.proxy_base_url}/intro/{site.slug}"
    return {"tester_link": proxy_url, "site_id": site.id}


def delete_tester_link(db: Session, target_url: str, label: str | None = None) -> bool:
    site = _site_query(db, target_url, label).first()
    if site is None:
        return False
    db.delete(site)
    db.commit()
    return True
