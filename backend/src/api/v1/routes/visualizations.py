from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from models.rating import Rating

router = APIRouter(prefix="/visualizations", tags=["Visualizations"])


@router.get("/sites/{site_id}/heatmap")
def get_click_heatmap(site_id: str, path: str | None = None):
    """Return aggregated click/interaction coordinates for heatmap rendering."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/sites/{site_id}/scroll-depth")
def get_scroll_depth(site_id: str, path: str | None = None):
    """Return per-path scroll depth distribution across all sessions."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/sites/{site_id}/journey-flow")
def get_journey_flow(site_id: str, limit: int = 100):
    """Return a node/edge graph of user navigation paths across sessions."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/sites/{site_id}/session-summary")
def get_session_summary(site_id: str):
    """Return aggregated session statistics (duration, event counts, device breakdown)."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/sites/{site_id}/task-completion")
def get_task_completion(site_id: str):
    """Return per-task completion rates and average times across tester sessions."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/sites/{site_id}/ratings-summary")
def get_ratings_summary(site_id: str, db: Session = Depends(get_db)):
    """Return aggregated UX rating scores (overall, navigation, design) for a site."""
    rows = db.query(Rating).filter(Rating.site_id == site_id).all()
    if not rows:
        return {"count": 0, "overall": None, "navigation": None, "design": None, "comments": []}
    n = len(rows)
    return {
        "count": n,
        "overall": round(sum(r.overall for r in rows) / n, 2),
        "navigation": round(sum(r.navigation for r in rows) / n, 2),
        "design": round(sum(r.design for r in rows) / n, 2),
        "comments": [r.comment for r in rows if r.comment][:20],
    }
