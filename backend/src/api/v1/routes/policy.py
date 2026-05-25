from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.deps import get_db
import services.policy as policy_svc

router = APIRouter(tags=["Policy"])


@router.get("/sites/{site_id}/policy")
def get_site_policy(
    site_id: str,
    task_id: int | None = Query(None, description="Reserved for future task-scoped filtering"),
    db: Session = Depends(get_db),
):
    """
    Aggregate behavioral policy from all human sessions on this site.

    Returns per-page action distributions — what fraction of users clicked
    what, how long they stayed, and what they hovered without clicking.
    The policy is site-wide (not task-scoped) because tracker sessions are
    not linked to tasks at the DB level.
    """
    policy = policy_svc.build_policy(site_id, db, task_id=task_id)
    return {"site_id": site_id, "policy": policy, "n_pages": len(policy)}
