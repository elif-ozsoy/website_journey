from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/evaluation", tags=["Evaluation"])


class TesterJourneyEvalRequest(BaseModel):
    site_id: str
    session_ids: list[str] | None = None  # if None, evaluate all sessions for the site
    model_id: str | None = None           # which evaluation model to use


class TesterJourneyEvalResponse(BaseModel):
    site_id: str
    session_count: int
    results: list[dict]  # per-session evaluation results


class AIAgentJourneyEvalRequest(BaseModel):
    site_id: str
    agent_run_id: str | None = None  # specific agent run, or None for latest
    model_id: str | None = None


class AIAgentJourneyEvalResponse(BaseModel):
    site_id: str
    agent_run_id: str
    results: dict  # evaluation results for the agent run


@router.post("/tester-journey", response_model=TesterJourneyEvalResponse)
def evaluate_tester_journey(body: TesterJourneyEvalRequest):
    """Evaluate recorded tester journeys using the configured evaluation model."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/ai-agent-journey", response_model=AIAgentJourneyEvalResponse)
def evaluate_ai_agent_journey(body: AIAgentJourneyEvalRequest):
    """Evaluate an AI agent's navigation journey on a site."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/tester-journey/{site_id}", response_model=list[dict])
def list_tester_journey_evaluations(site_id: str):
    """List all stored tester journey evaluation results for a site."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/ai-agent-journey/{site_id}", response_model=list[dict])
def list_ai_agent_journey_evaluations(site_id: str):
    """List all stored AI agent journey evaluation results for a site."""
    raise HTTPException(status_code=501, detail="Not implemented")
