from datetime import datetime

from pydantic import BaseModel


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    focus_areas: list[str] | None = None
    expected_solution: str | None = None


class TaskUpdate(BaseModel):
    title: str
    description: str | None = None
    focus_areas: list[str] | None = None
    expected_solution: str | None = None


class TaskResponse(BaseModel):
    id: int
    site_id: str
    title: str
    description: str | None
    order_index: int
    created_at: datetime
    focus_areas: list[str] | None = None
    expected_solution: str | None = None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    site_id: str
    started_at: datetime
    user_agent: str | None
    viewport_w: int | None
    viewport_h: int | None
    referrer: str | None
    device_type: str | None

    model_config = {"from_attributes": True}


class EventResponse(BaseModel):
    id: int
    session_id: str
    site_id: str
    type: str
    timestamp: float
    path: str | None
    data: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
