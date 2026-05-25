from fastapi import APIRouter, HTTPException
from fastapi_versioning import version
from pydantic import BaseModel

router = APIRouter(prefix="/debug", tags=["Debug"])


# ---------------------------------------------------------------------------
# Shared schemas
# ---------------------------------------------------------------------------

class TrainRequest(BaseModel):
    dataset_path: str | None = None
    config: dict | None = None             # model-specific hyperparameters


class TrainResponse(BaseModel):
    job_id: str
    status: str                            # "queued" | "running" | "done" | "failed"


class InferenceRequest(BaseModel):
    input: dict                            # model-specific input payload
    model_checkpoint: str | None = None   # path or identifier of checkpoint to use


class InferenceResponse(BaseModel):
    output: dict
    model_checkpoint: str | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float | None = None          # 0.0–1.0 if available
    metrics: dict | None = None            # loss, accuracy, etc.
    error: str | None = None


# ---------------------------------------------------------------------------
# Web agent endpoints
# ---------------------------------------------------------------------------

@router.post("/web-agent/train", response_model=TrainResponse)
@version(1)
async def web_agent_train(body: TrainRequest):
    """Trigger a debug training run for the custom web agent model."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/web-agent/inference", response_model=InferenceResponse)
@version(1)
async def web_agent_inference(body: InferenceRequest):
    """Run a single inference pass through the web agent model."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/web-agent/status/{job_id}", response_model=JobStatusResponse)
@version(1)
async def web_agent_status(job_id: str):
    """Poll the status of a web-agent training or inference job."""
    raise HTTPException(status_code=501, detail="Not implemented")


# ---------------------------------------------------------------------------
# Evaluation model endpoints
# ---------------------------------------------------------------------------

@router.post("/evaluation-model/train", response_model=TrainResponse)
@version(1)
async def evaluation_model_train(body: TrainRequest):
    """Trigger a debug training run for the evaluation model."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/evaluation-model/inference", response_model=InferenceResponse)
@version(1)
async def evaluation_model_inference(body: InferenceRequest):
    """Run a single inference pass through the evaluation model."""
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/evaluation-model/status/{job_id}", response_model=JobStatusResponse)
@version(1)
async def evaluation_model_status(job_id: str):
    """Poll the status of an evaluation-model training or inference job."""
    raise HTTPException(status_code=501, detail="Not implemented")
