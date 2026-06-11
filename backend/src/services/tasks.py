import json as _json

from sqlalchemy.orm import Session

from models.task import Task


def task_to_dict(task: Task) -> dict:
    return {
        "id": task.id,
        "site_id": task.site_id,
        "title": task.title,
        "description": task.description,
        "order_index": task.order_index,
        "created_at": task.created_at,
        "focus_areas": _json.loads(task.focus_areas) if task.focus_areas else None,
        "expected_solution": task.expected_solution,
    }


def list_tasks(db: Session, site_id: str) -> list[Task]:
    return (
        db.query(Task)
        .filter(Task.site_id == site_id)
        .order_by(Task.order_index.asc(), Task.id.asc())
        .all()
    )


def get_task(db: Session, task_id: int) -> Task | None:
    return db.get(Task, task_id)


def create_task(
    db: Session,
    site_id: str,
    title: str,
    description: str | None,
    focus_areas: list[str] | None = None,
    expected_solution: str | None = None,
) -> Task:
    count = db.query(Task).filter(Task.site_id == site_id).count()
    task = Task(
        site_id=site_id,
        title=title[:200],
        description=description[:1000] if description else None,
        order_index=count,
        focus_areas=_json.dumps(focus_areas) if focus_areas else None,
        expected_solution=expected_solution[:2000] if expected_solution else None,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(
    db: Session,
    task_id: int,
    title: str,
    description: str | None,
    focus_areas: list[str] | None = None,
    expected_solution: str | None = None,
) -> Task | None:
    task = db.get(Task, task_id)
    if task is None:
        return None
    task.title = title[:200]
    task.description = description[:1000] if description else None
    task.focus_areas = _json.dumps(focus_areas) if focus_areas else None
    task.expected_solution = expected_solution[:2000] if expected_solution else None
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int) -> bool:
    task = db.get(Task, task_id)
    if task is None:
        return False
    db.delete(task)
    db.commit()
    return True
