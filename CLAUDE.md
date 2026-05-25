# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CipherCorgi is a research platform for comparing **simulated AI agent journeys** against **real human user journeys** on websites. It collects user behavior via a tracking script, runs LLM-powered browser agents (via `browser-use`) on the same tasks, and provides a dashboard to compare and analyze results.

## Development Setup

### Prerequisites
- Docker and Docker Compose
- Node.js and pnpm

### Start backend + database
```bash
docker compose up backend postgres
```
Backend available at `http://localhost:8080`. Hot-reload is enabled for `backend/src/`.

### Start frontend (separate terminal)
```bash
cd frontend
pnpm install
pnpm dev
```
Frontend at `http://localhost:3000`. Proxies `/api/*` to the backend.

### Local LLM (no API key)
```bash
LOCAL_LLM_BASE_URL=http://host.docker.internal:8001/v1 \
LOCAL_LLM_MODEL=your-model-name \
LOCAL_LLM_API_KEY=not-needed \
docker compose up backend postgres
```
Then select "Local OpenAI-compatible" in the UI.

## Architecture

Three services: **backend** (FastAPI, port 8080), **frontend** (React/Vite, port 3000), **microservice** (FastAPI ML service, port 8081), all backed by **PostgreSQL**.

### Backend (`backend/src/`)

FastAPI app with two API layers:

- **`/v1/...`** — REST API for auth, projects/sites, tasks, sessions, journeys, analytics, screenshots
- **`/api/...`** — Unversioned tracking endpoints (event ingestion from the browser extension/tracking script), ratings
- **`/ws/run`** — WebSocket endpoint that streams agent execution steps in real time
- **`/proxy/...`** — Reverse proxy for wrapping target sites with the tracking script injected

Key services:
- `services/agent_runner.py` — runs `browser-use` Agent, supports `nvidia`, `google`, and `local` LLM providers; streams steps via callbacks
- `services/journeys.py` — upserts journey records (one per user+task+site); persists screenshots
- `api/routes/agent_ws.py` — WebSocket handler that calls `agent_runner`, then persists the result to DB

DB models in `models/`: `Site`, `Task`, `Session`, `Event`, `Journey`, `Screenshot`, `User`, `UserToken`, `Rating`.

The DB schema is created on startup by `db/init_db.py` using SQLAlchemy `create_all`.

### Frontend (`frontend/src/`)

React + TypeScript + Tailwind. Routing via `react-router-dom`.

Key contexts:
- `AgentRunContext` — global state for a multi-task agent run; manages the WebSocket lifecycle, streams steps back, and calls the REST API to persist journeys
- `ProjectContext` — stores the active project/site

Pages follow the user workflow: `LoginPage` → `HomePage` → `MyProjectsPage` → `ProjectShell` (which wraps `EvaluationPage`, `AgentRunPage`, `DashboardPage`).

All API calls go through `lib/api.ts` which reads `ciphercorgi_token` from `localStorage` and attaches it as a Bearer token.

### Microservice (`microservice/src/`)

An ML service for a VLM fine-tuning pipeline. Not used in the main web app flow — it's a research pipeline with 4 phases:

1. **Phase 1 (Hydration)** — converts raw Adobe click-data parquet → multi-modal trajectories with screenshots and DOM snapshots
2. **Phase 2 (Training)** — QLoRA fine-tune of Gemma-4 E4B on hydrated trajectories
3. **Phase 3 (Evaluator)** — runs the fine-tuned adapter as a `browser-use` agent with UX and accessibility metrics (axe-core WCAG)
4. **Phase 4 (Flywheel)** — nightly adapter updates from human-recorded trajectories + replay buffer

Pipeline scripts are in `microservice/src/scripts/`. All commands run from the **project root**, not from inside `microservice/`:
```bash
conda run -n xaiml python microservice/src/scripts/hydrate.py --parquet research/data/adobe.parquet
conda run -n xaiml torchrun --nproc_per_node=1 microservice/src/scripts/train_vlm.py \
    --train-jsonl pipeline_data/trajectories/hydrated.jsonl \
    --output-dir pipeline_data/adapters/v1
conda run -n xaiml python microservice/src/scripts/run_evaluator.py \
    --adapter pipeline_data/adapters/v1 --goal "..." --url "https://..."
```

Pipeline config and hyperparameters (LoRA rank/alpha, epochs, LR, etc.) are in `microservice/src/pipeline/config.py` and can be overridden via environment variables.

## Backend Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/postgres` | PostgreSQL connection |
| `LOCAL_LLM_BASE_URL` | `http://host.docker.internal:11434/v1` | Local model endpoint |
| `LOCAL_LLM_MODEL` | `local-model` | Model name for local provider |
| `LOCAL_LLM_API_KEY` | `not-needed` | API key for local provider |
| `PROXY_BASE_URL` | `http://localhost:8080` | Used when building proxy URLs |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Allowed CORS origins |

## LLM Providers (agent runs)

Supported in `services/agent_runner.py`:
- `nvidia` — NVIDIA NIM API (default: `qwen/qwen3.5-122b-a10b`)
- `google` — Google Gemini API (default: `gemini-3-flash-preview`)
- `local` — Any OpenAI-compatible local server

## Deployment

Kubernetes manifests are in `helm/`. Frontend is served as a static build behind nginx (`frontend/nginx.conf`).


## Browser-use documentation
https://docs.browser-use.com/cloud/llms.txt