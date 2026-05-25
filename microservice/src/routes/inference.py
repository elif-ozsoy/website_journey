"""
Inference endpoints — VLM pipeline (Gemma-4 E4B + Browser-Use).

Endpoints
---------
POST /v1/inference/evaluate-url         — run the VLM agent on a URL + goal
POST /v1/inference/accessibility-report — axe-core + VLM visual a11y scan only
POST /v1/inference/ingest-human         — ingest a human-recorded trajectory
POST /v1/inference/ingest-correction    — ingest a human correction
POST /v1/inference/ingest-schema        — build site_schema.json (legacy)

Legacy endpoints kept for backward compatibility:
POST /v1/inference/score
POST /v1/inference/score-batch
POST /v1/inference/site-report
"""
import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi_versioning import version
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/inference", tags=["Inference"])

# ── Shared agent singleton (loaded lazily on first request) ───────────────────

_agent = None
_agent_lock = asyncio.Lock()


def _get_adapter_dir() -> str:
    return os.getenv(
        "VLM_ADAPTER_DIR",
        os.path.join("pipeline_data", "adapters", "current"),
    )


async def _get_agent():
    global _agent
    async with _agent_lock:
        if _agent is None:
            adapter_dir = _get_adapter_dir()
            if not os.path.isdir(adapter_dir):
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Adapter not found at {adapter_dir!r}. "
                        "Run scripts/train_vlm.py first, or set VLM_ADAPTER_DIR."
                    ),
                )
            from pipeline.phase3_evaluator import GemmaWebAgent
            _agent = GemmaWebAgent(adapter_dir=adapter_dir)
    return _agent


# ── Request / response models ─────────────────────────────────────────────────

class EvaluateURLRequest(BaseModel):
    goal:        str
    url:         str
    max_steps:   int = 30
    output_dir:  Optional[str] = None


class A11yRequest(BaseModel):
    url: str


class HumanTrajectoryRequest(BaseModel):
    goal:  str
    site:  str
    steps: List[Dict[str, Any]]


class CorrectionRequest(BaseModel):
    trajectory_id:   str
    step_index:      int
    goal:            str
    wrong_som_box:   Optional[int] = None
    correct_som_box: int
    screenshot_path: Optional[str] = None
    dom_path:        Optional[str] = None
    som_map:         Optional[Dict[str, str]] = None


class IngestRequest(BaseModel):
    site_url:    str
    page_urls:   List[str]
    selectors:   Optional[List[str]] = None
    output_path: Optional[str] = None


# Legacy schemas
class Step(BaseModel):
    page_type:        Optional[str] = None
    page_depth:       Optional[int] = None
    element_role:     Optional[str] = None
    dest_type:        Optional[str] = None
    page_url:         Optional[str] = None
    click_source:     Optional[str] = None
    click_target_url: Optional[str] = None


class JourneyRequest(BaseModel):
    steps:           List[Step]
    task:            Optional[str] = None
    schema_path:     Optional[str] = None
    checkpoint_path: Optional[str] = None
    detector_path:   Optional[str] = None


class SessionRequest(BaseModel):
    sessions:        List[Dict[str, Any]]
    checkpoint_path: Optional[str] = None
    detector_path:   Optional[str] = None


# ── Phase 3 – VLM Evaluator ───────────────────────────────────────────────────

@router.post("/evaluate-url")
@version(1)
async def evaluate_url(req: EvaluateURLRequest):
    """
    Run the fine-tuned Gemma-4 Browser-Use agent on a URL.
    Returns a full SessionReport with UX metrics and accessibility violations.
    """
    agent = await _get_agent()
    try:
        report = await agent.evaluate(
            goal=req.goal,
            start_url=req.url,
            output_dir=req.output_dir,
        )
        return report.to_dict()
    except Exception as e:
        log.exception("evaluate_url failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accessibility-report")
@version(1)
async def accessibility_report(req: A11yRequest):
    """
    Run axe-core + VLM visual inspection on a URL without the full agent loop.
    Returns a list of accessibility violations.
    """
    agent = await _get_agent()
    try:
        from playwright.async_api import async_playwright
        from pipeline.phase3_evaluator import run_axe, vlm_visual_a11y
        from pipeline.phase1_hydration import capture_som_page
        import tempfile, os

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 800})
            page    = await context.new_page()
            await page.goto(req.url, wait_until="domcontentloaded", timeout=30_000)

            with tempfile.TemporaryDirectory() as tmp:
                ss_path  = os.path.join(tmp, "screen.png")
                dom_path = os.path.join(tmp, "dom.html")
                await capture_som_page(page, req.url, ss_path, dom_path)

                axe_violations = await run_axe(page)
                agent._load_model()
                vlm_violations = await vlm_visual_a11y(
                    ss_path, agent._model, agent._processor
                )

            await browser.close()

        return {
            "url": req.url,
            "axe_violations":  axe_violations,
            "vlm_violations":  vlm_violations,
            "total_violations": len(axe_violations) + len(vlm_violations),
        }
    except Exception as e:
        log.exception("accessibility_report failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 4 – Human data ingestion ───────────────────────────────────────────

@router.post("/ingest-human")
@version(1)
async def ingest_human_trajectory(req: HumanTrajectoryRequest):
    """
    Ingest a human-recorded trajectory (from the browser extension).
    Persists screenshots, DOM, and trajectory metadata for nightly training.
    """
    from pipeline.phase4_flywheel import ingest_human_trajectory as _ingest
    try:
        trajectory_id = _ingest(req.model_dump())
        return {"status": "accepted", "trajectory_id": trajectory_id}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        log.exception("ingest_human failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ingest-correction")
@version(1)
async def ingest_correction(req: CorrectionRequest):
    """
    Ingest a human correction (wrong box → correct box) from the review UI.
    Used for human-in-the-loop robustness training.
    """
    from pipeline.phase4_flywheel import ingest_correction as _ingest_corr
    try:
        trajectory_id = _ingest_corr(req.model_dump())
        return {"status": "accepted", "trajectory_id": trajectory_id}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        log.exception("ingest_correction failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 1 – Schema ingestion (legacy, kept intact) ─────────────────────────

@router.post("/ingest-schema")
@version(1)
async def ingest_schema(req: IngestRequest):
    """
    Auto-generate a site_schema.json from a list of URLs and CSS selectors.
    """
    from ingestion.schema_builder import SiteSchemaBuilder
    builder = SiteSchemaBuilder(use_nli=True)
    schema  = builder.build(
        site_url=req.site_url,
        page_urls=req.page_urls,
        selectors=req.selectors or [],
        output_path=req.output_path,
        verbose=False,
    )
    return schema


# ── Legacy endpoints (transformer-based, backward compat) ─────────────────────

@router.post("/score")
@version(1)
async def score_journey(req: JourneyRequest):
    """
    [Legacy] Score a single journey with the original JourneyTransformer.
    Requires a pretrained checkpoint at req.checkpoint_path.
    """
    if not req.checkpoint_path:
        raise HTTPException(
            status_code=400,
            detail="Provide checkpoint_path to use the legacy transformer scorer."
        )
    try:
        import torch
        from model.transformer import JourneyTransformer
        from model.config import ModelConfig
        from model.metrics import journey_metrics
        from ingestion.feature_extractor import FeatureExtractor

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        ckpt   = torch.load(req.checkpoint_path, map_location=device)
        cfg    = ModelConfig(**ckpt["config"])
        model  = JourneyTransformer(cfg).to(device)
        model.load_state_dict(ckpt["model"])
        model.eval()

        extractor = FeatureExtractor(schema_path=req.schema_path)
        steps = [
            extractor.extract(
                page_url=s.page_url or "",
                click_source=s.click_source or "",
                click_target_url=s.click_target_url or "",
                page_type=s.page_type,
                page_depth=s.page_depth,
                element_role=s.element_role,
                dest_type=s.dest_type,
            )
            for s in req.steps
        ]
        metrics = journey_metrics(model, steps, device=device)

        if req.detector_path and os.path.exists(req.detector_path):
            from model.metrics import MahalanobisDetector, journey_embedding
            detector = MahalanobisDetector.load(req.detector_path)
            emb      = journey_embedding(model, steps, device=device)
            metrics["anomaly_score"] = float(detector.score(emb))

        return metrics
    except Exception as e:
        log.exception("score failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/score-batch")
@version(1)
async def score_batch(req: SessionRequest):
    """[Legacy] Score a batch of sessions with the original transformer."""
    raise HTTPException(
        status_code=501,
        detail="Use /evaluate-url for VLM-based evaluation. "
               "Transformer batch scoring: wire checkpoint_path to enable."
    )


@router.post("/site-report")
@version(1)
async def site_report(req: SessionRequest):
    """[Legacy] Aggregate site report with the original transformer."""
    raise HTTPException(
        status_code=501,
        detail="Use /evaluate-url for VLM-based evaluation. "
               "Transformer site-report: wire checkpoint_path to enable."
    )
