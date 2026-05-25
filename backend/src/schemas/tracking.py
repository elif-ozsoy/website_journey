from pydantic import BaseModel


class SessionCreate(BaseModel):
    session_id: str
    site_id: str
    user_agent: str | None = None
    viewport_w: int | None = None
    viewport_h: int | None = None
    referrer: str | None = None
    device_type: str | None = None


class EventItem(BaseModel):
    session_id: str
    site_id: str
    type: str
    timestamp: float
    path: str | None = None
    data: dict | None = None


class EventBatch(BaseModel):
    events: list[EventItem]
