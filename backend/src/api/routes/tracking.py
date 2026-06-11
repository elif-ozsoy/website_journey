from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_db
from models.rating import Rating
from models.site import Site
from schemas.tracking import EventBatch, SessionCreate
from services.tracking import batch_insert_events, create_session

router = APIRouter(prefix="/api", tags=["Tracking"])


@router.post("/sessions", status_code=201)
def register_session(body: SessionCreate, db: Session = Depends(get_db)):
    create_session(db, body)
    return {"ok": True}


@router.post("/events", status_code=201)
def ingest_events(body: EventBatch, db: Session = Depends(get_db)):
    batch_insert_events(db, body)
    return {"ok": True}


class RatingCreate(BaseModel):
    session_id: str
    site_id: str
    overall: int
    navigation: int
    design: int
    comment: str | None = None

class TaskOutcomeCreate(BaseModel):
    session_id: str
    site_id: str
    task_id: int | str | None = None   # ← accept either
    task_title: str
    task_index: int | None = None
    outcome: str
    comment: str | None = None

@router.post("/ratings", status_code=201)
def submit_rating(body: RatingCreate, db: Session = Depends(get_db)):
    db.add(Rating(
        session_id=body.session_id,
        site_id=body.site_id,
        overall=max(1, min(5, body.overall)),
        navigation=max(1, min(5, body.navigation)),
        design=max(1, min(5, body.design)),
        comment=(body.comment or "")[:1000] or None,
    ))
    db.commit()
    return {"ok": True}


@router.post("/task_outcomes", status_code=201)
def submit_task_outcomes(
    body: list[TaskOutcomeCreate],
    db: Session = Depends(get_db),
):
    """Receive a batch of per-task outcomes from the finished page.
 
    Stored as `event` rows with type='task_outcome' — no schema change. Each
    row's data payload carries the full TaskOutcomeCreate so the journey
    service can later derive outcome status per (session_id, task_title).
    """
    import json as _json
    import time as _time
 
    from models.event import Event
 
    # If the user changed their mind and resubmits, the latest row wins.
    # We don't dedupe here — the read side picks max(created_at).
    now_ms = int(_time.time() * 1000)
    rows = []
    for item in body:
        if item.outcome not in ("success", "failed"):
            continue
        rows.append(Event(
            session_id=item.session_id,
            site_id=item.site_id,
            type="task_outcome",
            path="/finished",
            timestamp=now_ms,
            data=_json.dumps({
                "task_id": item.task_id,
                "task_title": item.task_title,
                "task_index": item.task_index,
                "outcome": item.outcome,
                "comment": (item.comment or "").strip()[:1000] or None,
            }),
        ))
    if rows:
        db.add_all(rows)
        db.commit()
    return {"ok": True, "count": len(rows)}

_FINISHED_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tasks Complete — {site_name}</title>
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
    margin-bottom:10px;
  }}
  h1{{font-size:22px;font-weight:700;color:#1A2B42;margin-bottom:6px;}}
  .subtitle{{color:#5C6B82;font-size:14px;margin-bottom:28px;}}
  .divider{{height:1px;background:#E1E8F0;margin:24px 0;}}
  .section-title{{font-size:15px;font-weight:600;color:#1A2B42;margin-bottom:14px;}}
  /* ── Per-task outcomes ── */
  .tasks-list{{display:flex;flex-direction:column;gap:12px;}}
  .task-row{{
    border:1px solid #E1E8F0;
    border-radius:10px;
    padding:14px 16px;
    transition:border-color .15s;
  }}
  .task-row:has(.task-outcome:checked[value="failed"]){{
    border-color:#F4B6A8;
    background:#FEF6F4;
  }}
  .task-title{{
    font-size:14px;font-weight:600;color:#1A2B42;
    margin-bottom:10px;line-height:1.4;
  }}
  .outcome-row{{
    display:flex;gap:8px;
  }}
  .outcome-row label{{
    flex:1;
    display:flex;align-items:center;justify-content:center;gap:6px;
    padding:7px 10px;
    border:1.5px solid #E1E8F0;
    border-radius:8px;
    font-size:13px;font-weight:500;
    color:#5C6B82;
    cursor:pointer;
    transition:all .12s;
  }}
  .outcome-row input[type="radio"]{{display:none;}}
  .outcome-row label:hover{{background:#F7F9FC;}}
  .outcome-row input[type="radio"]:checked + span{{font-weight:700;}}
  .outcome-row label:has(input[value="success"]:checked){{
    border-color:#185FA5;color:#185FA5;background:#EBF3FC;
  }}
  .outcome-row label:has(input[value="failed"]:checked){{
    border-color:#C73E1D;color:#C73E1D;background:#FCE9E3;
  }}
  /* ── Site rating ── */
  .rating-label{{font-size:12px;font-weight:500;color:#5C6B82;margin-bottom:6px;}}
  .stars{{display:flex;gap:6px;margin-bottom:16px;}}
  .star{{font-size:26px;cursor:pointer;color:#185FA5;user-select:none;transition:transform .1s;}}
  .star:hover{{transform:scale(1.15);}}
  textarea{{
    width:100%;height:72px;
    background:#F7F9FC;
    border:1px solid #E1E8F0;
    border-radius:8px;
    color:#1A2B42;
    padding:10px 14px;
    font:14px 'DM Sans',system-ui,sans-serif;
    resize:vertical;
    outline:none;
  }}
  textarea:focus{{border-color:#185FA5;box-shadow:0 0 0 3px #DCEBFA;}}
  .btn{{
    width:100%;
    padding:11px;
    background:#185FA5;
    color:#fff;
    border:none;
    border-radius:8px;
    font:600 15px 'DM Sans',system-ui,sans-serif;
    cursor:pointer;
    margin-top:18px;
    transition:background .15s;
  }}
  .btn:hover{{background:#134A82;}}
  .btn:disabled{{background:#94A0B5;cursor:default;}}
  .thanks{{display:none;text-align:center;padding:20px 0;color:#1A2B42;font-size:16px;font-weight:600;}}
</style>
</head>
<body>
<div class="card">
  <div class="label">UX Study</div>
  <h1>All tasks complete</h1>
  <p class="subtitle">You have finished the test for <strong style="color:#1A2B42">{site_name}</strong>. Please confirm which tasks you actually completed, then rate your experience.</p>
 
  <div id="mainForm">
    <!-- Per-task outcomes -->
    <div class="section-title">Did you complete each task?</div>
    <div class="tasks-list" id="tasksList">
      {tasks_html}
    </div>
 
    <div class="divider"></div>
 
    <!-- Site rating -->
    <div class="section-title">Rate your experience</div>
    <div class="rating-label">Overall Experience</div>
    <div class="stars" id="stars-overall"></div>
    <div class="rating-label">Easy to Navigate</div>
    <div class="stars" id="stars-navigation"></div>
    <div class="rating-label">Visual Design</div>
    <div class="stars" id="stars-design"></div>
    <div class="rating-label" style="margin-top:4px">Comments (optional)</div>
    <textarea id="ratingComment" placeholder="Any feedback or observations"></textarea>
    <button class="btn" id="submitBtn" onclick="submitAll()">Submit Feedback</button>
  </div>
  <div class="thanks" id="thanksMsg">Thank you for your feedback.</div>
</div>
<script>
var siteId = {site_id_json};
var sessionId = {session_id_json};
var attemptedTasks = {tasks_json};   // [{{task_id, task_title, task_index, attempted}}]
var ratings = {{overall:0, navigation:0, design:0}};
 
// Build rating stars (unchanged from before)
["overall","navigation","design"].forEach(function(field) {{
  var container = document.getElementById("stars-" + field);
  for (var i = 1; i <= 5; i++) {{
    var s = document.createElement("span");
    s.className = "star"; s.textContent = "☆"; s.dataset.value = i; s.dataset.field = field;
    s.addEventListener("click", function() {{
      var val = parseInt(this.dataset.value), f = this.dataset.field;
      ratings[f] = val;
      var siblings = this.parentElement.children;
      for (var j = 0; j < siblings.length; j++) siblings[j].textContent = j < val ? "★" : "☆";
    }});
    container.appendChild(s);
  }}
}});
 
function collectTaskOutcomes() {{
  // For each attempted task, read which radio is checked.
  var out = [];
  for (var i = 0; i < attemptedTasks.length; i++) {{
    var t = attemptedTasks[i];
    var picked = document.querySelector('input[name="outcome-' + i + '"]:checked');
    if (!picked) return null;   // not all answered yet
    out.push({{
      session_id: sessionId,
      site_id: siteId,
      task_id: t.task_id || null,
      task_title: t.task_title,
      task_index: t.task_index,
      outcome: picked.value,
    }});
  }}
  return out;
}}
 
function submitAll() {{
  var taskOutcomes = collectTaskOutcomes();
  if (taskOutcomes === null) {{
    flashError("Please mark every task as completed or not.");
    return;
  }}
  if (!ratings.overall || !ratings.navigation || !ratings.design) {{
    flashError("Please rate all 3 categories");
    return;
  }}
  var btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Submitting…";
  var comment = (document.getElementById("ratingComment").value || "").trim();
 
  // 1) Send per-task outcomes
  var p1 = fetch("/api/task_outcomes", {{
    method: "POST", headers: {{"Content-Type": "application/json"}},
    body: JSON.stringify(taskOutcomes),
  }}).catch(function(){{}});
 
  // 2) Send site rating
  var p2 = fetch("/api/ratings", {{
    method: "POST", headers: {{"Content-Type": "application/json"}},
    body: JSON.stringify({{session_id: sessionId, site_id: siteId, overall: ratings.overall, navigation: ratings.navigation, design: ratings.design, comment: comment}}),
  }}).catch(function(){{}});
 
  Promise.all([p1, p2]).then(function() {{
    document.getElementById("mainForm").style.display = "none";
    document.getElementById("thanksMsg").style.display = "block";
  }});
}}
 
function flashError(msg) {{
  var btn = document.getElementById("submitBtn");
  var orig = btn.textContent;
  btn.textContent = msg; btn.style.background = "#C73E1D";
  setTimeout(function() {{ btn.textContent = orig; btn.style.background = ""; }}, 2200);
}}
</script>
</body>
</html>"""
 
 
def _build_tasks_html(attempted_tasks):
    """Render the per-task outcome rows. `attempted_tasks` is a list of dicts
    with keys: task_id, task_title, task_index, attempted (bool)."""
    if not attempted_tasks:
        return (
            '<div style="color:#94A0B5;font-size:13px;font-style:italic;padding:12px 0;">'
            'No tasks recorded for this session.'
            '</div>'
        )
    parts = []
    for i, t in enumerate(attempted_tasks):
        title = (t.get("task_title") or f"Task {i + 1}").replace("<", "&lt;").replace(">", "&gt;")
        # Default selection: "success" if the user clicked Task done ✓ on the overlay,
        # otherwise leave it un-pre-selected so they explicitly answer.
        success_checked = "checked" if t.get("attempted") else ""
        parts.append(f'''
<div class="task-row">
  <div class="task-title">{i + 1}. {title}</div>
  <div class="outcome-row">
    <label>
      <input type="radio" name="outcome-{i}" value="success" {success_checked}>
      <span>✓ Completed</span>
    </label>
    <label>
      <input type="radio" name="outcome-{i}" value="failed">
      <span>✗ Couldn't complete</span>
    </label>
  </div>
</div>''')
    return "".join(parts)
 

_finished_router = APIRouter(tags=["Tracking"])

 
@_finished_router.get("/finished", response_class=HTMLResponse, include_in_schema=False)
def finished_page(site_id: str = "", session_id: str = "", db: Session = Depends(get_db)):
    """Render the finished page. Pulls the actual task list from the site
    config and pairs it with task_complete events for this session so we know
    which ones the user reached the 'done' button for."""
    import json as _json
 
    from models.event import Event
 
    site = db.get(Site, site_id) if site_id else None
    if site:
        site_name = site.label or urlparse(site.target_url).hostname or site.target_url
    else:
        site_name = "the website"
 
    # Pull configured tasks from the site (if any). These are what was shown
    # to the tester. Falls back to attempted tasks if site has none configured.
    configured_tasks = []
    if site and getattr(site, "tasks", None):
        # site.tasks may already be a list-of-dicts or a JSON string depending
        # on your column type — handle both.
        raw = site.tasks
        try:
            if isinstance(raw, str):
                raw = _json.loads(raw)
            if isinstance(raw, list):
                configured_tasks = [t for t in raw if isinstance(t, dict)]
        except Exception:
            configured_tasks = []
 
    # Which tasks did the user click "Task done ✓" on?
    attempted_ids = set()
    if session_id:
        rows = (
            db.query(Event)
            .filter(Event.session_id == session_id, Event.type == "task_complete")
            .all()
        )
        for r in rows:
            try:
                d = _json.loads(r.data) if r.data else {}
                if d.get("task_id"):
                    attempted_ids.add(str(d["task_id"]))
                elif d.get("task_title"):
                    attempted_ids.add(d["task_title"])
            except Exception:
                pass
 
    # Build the final task list. Prefer configured tasks (so the user sees
    # ALL tasks they were given, even ones they never clicked done on).
    # Fall back to attempted ones if site has no configured tasks.
    tasks_for_ui = []
    if configured_tasks:
        for i, t in enumerate(configured_tasks):
            raw_id = t.get("id")
            tid = str(raw_id) if raw_id is not None else ""
            title = t.get("title") or f"Task {i + 1}"
            attempted = (
                (tid and tid in attempted_ids)
                or (raw_id is not None and str(int(raw_id)) in attempted_ids if isinstance(raw_id, (int, float)) else False)
                or (title in attempted_ids)
            )
            tasks_for_ui.append({
                "task_id": tid or None,
                "task_title": title,
                "task_index": i,
                "attempted": bool(attempted),
            })
    else:
        # No configured tasks — derive from completion events
        rows = (
            db.query(Event)
            .filter(Event.session_id == session_id, Event.type == "task_complete")
            .order_by(Event.created_at)
            .all()
        ) if session_id else []
        for r in rows:
            try:
                d = _json.loads(r.data) if r.data else {}
                tasks_for_ui.append({
                    "task_id": d.get("task_id"),
                    "task_title": d.get("task_title") or "Task",
                    "task_index": d.get("task_index"),
                    "attempted": True,
                })
            except Exception:
                pass
 
    tasks_html = _build_tasks_html(tasks_for_ui)
    tasks_json = _json.dumps(tasks_for_ui).replace("</", "<\\/")
 
    html = _FINISHED_HTML.format(
        site_name=site_name,
        site_id_json=_json.dumps(site_id),
        session_id_json=_json.dumps(session_id),
        tasks_html=tasks_html,
        tasks_json=tasks_json,
    )
    return HTMLResponse(content=html)
