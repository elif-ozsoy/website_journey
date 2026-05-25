from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_current_user_optional, get_db
from models.user import User
from models.site import Site
from schemas.data_collection import SiteDetail, TesterLinkRequest, TesterLinkResponse
import services.data_collection as svc
from core.config import settings

router = APIRouter(prefix="/data-collection", tags=["Data"])
sites_router = APIRouter(prefix="/sites", tags=["Data"])


@sites_router.get("/{site_id}", response_model=SiteDetail)
def get_site(site_id: str, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site not found")
    return SiteDetail(
        site_id=site.id,
        slug=site.slug,
        tester_link=f"{settings.proxy_base_url}/intro/{site.slug}",
        label=site.label,
        target_url=site.target_url,
    )


@sites_router.delete("/{site_id}", status_code=204)
def delete_site(
    site_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    site = db.get(Site, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Site not found")
    if site.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this site")
    db.delete(site)
    db.commit()
    return Response(status_code=204)


@router.post("/tester-link", response_model=TesterLinkResponse, status_code=201)
def create_tester_link(
    body: TesterLinkRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    try:
        user_id = current_user.id if current_user else None
        return svc.generate_tester_link(db, str(body.url), body.label, user_id=user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/tester-link", response_model=TesterLinkResponse)
def read_tester_link(url: str, label: str | None = None, db: Session = Depends(get_db)):
    result = svc.get_tester_link(db, url, label)
    if result is None:
        raise HTTPException(status_code=404, detail="Tester link not found")
    return result


@router.delete("/tester-link", status_code=204)
def remove_tester_link(url: str, label: str | None = None, db: Session = Depends(get_db)):
    if not svc.delete_tester_link(db, url, label):
        raise HTTPException(status_code=404, detail="Tester link not found")
    return Response(status_code=204)
