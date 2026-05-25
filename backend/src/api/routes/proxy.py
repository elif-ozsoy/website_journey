from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from api.deps import get_db
from core.config import settings
from models.site import Site
from models.task import Task
from services.proxy import handle_proxy_request

router = APIRouter(tags=["Proxy"])

_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]

_INTRO_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{site_name} — UX Study</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  *{{margin:0;padding:0;box-sizing:border-box;}}
  body{{
    background:#F7F9FC;
    color:#1A2B42;
    font-family:'DM Sans',system-ui,sans-serif;
    font-size:15px;
    line-height:1.6;
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
    -webkit-font-smoothing:antialiased;
  }}
  .card{{
    background:#ffffff;
    border:1px solid #E1E8F0;
    border-radius:16px;
    padding:40px 48px;
    max-width:560px;
    width:100%;
    box-shadow:0 4px 24px rgba(26,43,66,.08);
  }}
  .label{{
    font-size:12px;
    font-weight:600;
    letter-spacing:.06em;
    text-transform:uppercase;
    color:#94A0B5;
    margin-bottom:6px;
  }}
  h1{{font-size:22px;font-weight:700;color:#1A2B42;margin-bottom:6px;}}
  .subtitle{{color:#5C6B82;font-size:14px;margin-bottom:28px;}}
  .tasks{{list-style:none;margin-bottom:28px;display:flex;flex-direction:column;gap:10px;}}
  .task{{
    background:#F7F9FC;
    border:1px solid #E1E8F0;
    border-radius:10px;
    padding:14px 16px;
    display:flex;
    gap:14px;
    align-items:flex-start;
  }}
  .task-num{{
    background:#185FA5;
    color:#fff;
    border-radius:50%;
    width:22px;height:22px;min-width:22px;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:700;
    margin-top:2px;
  }}
  .task-title{{font-size:14px;font-weight:600;color:#1A2B42;margin-bottom:2px;}}
  .task-desc{{font-size:13px;color:#5C6B82;line-height:1.5;}}
  .hint{{
    font-size:13px;
    color:#5C6B82;
    margin-bottom:24px;
    line-height:1.6;
    padding:12px 14px;
    background:#EAF1F9;
    border-radius:8px;
  }}
  .btn{{
    display:block;
    width:100%;
    padding:11px;
    background:#185FA5;
    color:#fff;
    border:none;
    border-radius:8px;
    font:600 15px 'DM Sans',system-ui,sans-serif;
    cursor:pointer;
    text-align:center;
    text-decoration:none;
    transition:background .15s;
  }}
  .btn:hover{{background:#134A82;}}
</style>
</head>
<body>
<div class="card">
  <div class="label">UX Study</div>
  <h1>{site_name}</h1>
  <p class="subtitle">Please complete the following tasks in order.</p>
  <ol class="tasks">
{task_items}
  </ol>
  <p class="hint">A task panel will guide you through each step. Mark each task complete before moving on. Your interactions are recorded anonymously for research purposes.</p>
  <a class="btn" href="/site/{slug}/">Start</a>
</div>
</body>
</html>"""

_TASK_ITEM_HTML = """\
    <li class="task">
      <div class="task-num">{num}</div>
      <div>
        <div class="task-title">{title}</div>
        {desc_html}
      </div>
    </li>"""


@router.get("/intro/{slug}", include_in_schema=False, response_class=HTMLResponse)
def intro_page(slug: str, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.slug == slug).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    tasks = (
        db.query(Task)
        .filter(Task.site_id == site.id)
        .order_by(Task.order_index, Task.id)
        .all()
    )
    if not tasks:
        return RedirectResponse(url=f"/site/{slug}/", status_code=302)

    site_name = site.label or urlparse(site.target_url).hostname or site.target_url

    task_items = "\n".join(
        _TASK_ITEM_HTML.format(
            num=i + 1,
            title=t.title,
            desc_html=f'<div class="task-desc">{t.description}</div>' if t.description else "",
        )
        for i, t in enumerate(tasks)
    )

    html = _INTRO_HTML.format(site_name=site_name, slug=slug, task_items=task_items)
    return HTMLResponse(content=html)


@router.get("/site/{slug}", include_in_schema=False)
async def proxy_root_redirect(slug: str):
    return RedirectResponse(url=f"/site/{slug}/", status_code=301)


@router.api_route("/site/{slug}/{path:path}", methods=_METHODS)
async def proxy(slug: str, path: str, request: Request, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.slug == slug).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    no_tasks_mode = request.query_params.get("notasks") == "1"
    tasks = [
        {"id": t.id, "title": t.title, "description": t.description, "order_index": t.order_index}
        for t in db.query(Task).filter(Task.site_id == site.id).order_by(Task.order_index, Task.id).all()
    ]
    # Release DB connection before the long upstream HTTP call
    db.close()

    return await handle_proxy_request(
    site, path, request, settings.proxy_base_url,
    client=request.app.state.http_client,
    tasks=tasks, no_tasks_mode=no_tasks_mode,
)
