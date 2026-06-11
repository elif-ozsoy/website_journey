from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from schemas.analytics import TaskCreate, TaskResponse, TaskUpdate
from services import tasks as svc

router = APIRouter(tags=["Tasks"])


@router.get("/sites/{site_id}/tasks", response_model=list[TaskResponse])
def list_tasks(site_id: str, db: Session = Depends(get_db)):
    return [svc.task_to_dict(t) for t in svc.list_tasks(db, site_id)]


@router.post("/sites/{site_id}/tasks", response_model=TaskResponse, status_code=201)
def create_task(site_id: str, body: TaskCreate, db: Session = Depends(get_db)):
    task = svc.create_task(db, site_id, body.title, body.description, body.focus_areas, body.expected_solution)
    return svc.task_to_dict(task)


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, body: TaskUpdate, db: Session = Depends(get_db)):
    task = svc.update_task(db, task_id, body.title, body.description, body.focus_areas, body.expected_solution)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return svc.task_to_dict(task)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    if not svc.delete_task(db, task_id):
        raise HTTPException(status_code=404, detail="Task not found")
