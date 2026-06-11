from datetime import datetime

from pydantic import BaseModel


class JourneySaveRequest(BaseModel):
    site_id: str
    task_title: str
    steps: list[dict]
    policy_trace: list[dict] | None = None
    task_id: int | None = None
    source: str = 'agent'
    is_agent: bool = True
    focus_areas: list[str] | None = None


class JourneyResponse(BaseModel):
    id: int
    site_id: str
    task_id: int | None
    user_id: str | None
    task_title: str
    total_steps: int
    steps: list[dict]
    policy_trace: list[dict] | None = None
    llm_analysis: str | None = None
    source: str = 'agent'
    is_agent: bool | None = None
    embedding: list[float] | None = None
    solution_eval: dict | None = None
    completed_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": False}


class TaskSummary(BaseModel):
    id: int
    title: str
    description: str | None
    order_index: int
    focus_areas: list[str] | None = None
    expected_solution: str | None = None


class ProjectWithJourneys(BaseModel):
    site_id: str
    slug: str
    tester_link: str
    label: str | None
    target_url: str
    created_at: str
    tasks: list[TaskSummary]
    journeys: list[JourneyResponse]
