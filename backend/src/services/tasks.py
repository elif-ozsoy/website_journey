from sqlalchemy.orm import Session

from models.task import Task


def list_tasks(db: Session, site_id: str) -> list[Task]:
    return (
        db.query(Task)
        .filter(Task.site_id == site_id)
        .order_by(Task.order_index.asc(), Task.id.asc())
        .all()
    )


def create_task(db: Session, site_id: str, title: str, description: str | None) -> Task:
    count = db.query(Task).filter(Task.site_id == site_id).count()
    task = Task(
        site_id=site_id,
        title=title[:200],
        description=description[:1000] if description else None,
        order_index=count,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, task_id: int, title: str, description: str | None) -> Task | None:
    task = db.get(Task, task_id)
    if task is None:
        return None
    task.title = title[:200]
    task.description = description[:1000] if description else None
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
