# Group 7 - Exploring Simulated Agent vs Real User Journeys

Proposal video: https://polybox.ethz.ch/index.php/s/pnJgm7b4SB2azHT

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/installation)

### 1. Start the backend and database

From the repo root, start PostgreSQL and the backend API via Docker Compose:

```bash
docker compose up backend postgres
```

The backend will be available at `http://localhost:8080`.  
Hot-reload is enabled — changes to `backend/src/` are reflected immediately.

### 2. Start the frontend

In a separate terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

The frontend will be available at `http://localhost:3000`.  
It proxies `/api/*` requests to the backend automatically (configured in [vite.config.ts](frontend/vite.config.ts)).

## Connecting to the Hosted PostgreSQL (Kubernetes)

The backend is configured to use the hosted Kubernetes Postgres by default (see [docker-compose.yml](docker-compose.yml)). All you need to do is keep a port-forward running — the backend reaches it via `host.docker.internal:5432`.

Credentials are defined in the `variables:` block of [.gitlab-ci.yml](.gitlab-ci.yml).

### Prerequisites

- [`kubectl`](https://kubernetes.io/docs/tasks/tools/) installed
- The kubeconfig file for the cluster (should have received it by email)

### 1. Save the kubeconfig

```bash
mkdir -p ~/.kube
# paste the kubeconfig content into this file
nano ~/.kube/ciphercorgi-config
chmod 600 ~/.kube/ciphercorgi-config
export KUBECONFIG=~/.kube/ciphercorgi-config
```

Verify access:

```bash
kubectl get pods -n xaiml-2026-projects-ciphercorgi
```

You should see the postgres pod (e.g. `ciphercorgi-postgres-0`).

### 2. Port-forward Postgres to localhost

```bash
kubectl port-forward -n xaiml-2026-projects-ciphercorgi \
  svc/ciphercorgi-postgres 5432:5432 --address 0.0.0.0
```

The `--address 0.0.0.0` flag is required so the Docker backend container can reach the port-forward via `host.docker.internal`. Without it, kubectl only binds to `127.0.0.1` and the container gets "Connection refused".

Leave this terminal open — it keeps the tunnel alive. Then start the backend as usual:

```bash
docker compose up backend
```

> **Note:** The port-forward drops if the terminal closes or the network blips. Re-run the `kubectl port-forward` command to restore it.

### 3. Connect with a Postgres client directly

You can also connect to the hosted DB with any Postgres client using the credentials from `.gitlab-ci.yml`:

```bash
psql postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>
```

Or use any GUI client (TablePlus, DBeaver, etc.) pointing at `localhost:5432`.

### Using the local Postgres instead

Stop the `kubectl port-forward` first (so port 5432 is free), then override `DATABASE_URL`:

```bash
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/postgres \
docker compose up backend postgres
```

---

## Local-Only Model Workflow (No Cloud API Key)

This project can run fully local for agent runs (no NVIDIA / Google key), as long as you run a local model server with an OpenAI-compatible API.

### What you need

- A local model endpoint reachable from your host machine (for example via `http://localhost:<port>/v1`)
- Backend + Postgres (Docker Compose)
- Frontend (Vite)

### 1. Start a local model server on your machine

Use any OpenAI-compatible local runtime (for example llama.cpp server, vLLM, or another local provider).

Example shape (replace with your own runtime command):

```bash
# Example only - use your actual local model runtime
# It should expose endpoints under /v1 (OpenAI-compatible)
local-model-server --host 0.0.0.0 --port 8001
```

Recommended for 16GB VRAM: start with Gemma 4 E4B in 4-bit quantization and a moderate context length (for example 2K-4K), then increase if stable.

### 2. Start backend + database with local model env vars

From repo root:

```bash
LOCAL_LLM_BASE_URL=http://host.docker.internal:8001/v1 \
LOCAL_LLM_MODEL=your-local-model-name \
LOCAL_LLM_API_KEY=not-needed \
docker compose up backend postgres
```

Notes:

- `host.docker.internal` is used so the backend container can reach the model server running on your host.
- If your local server requires a key, set `LOCAL_LLM_API_KEY` accordingly.

### 3. Start frontend

In a second terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

### 4. Run agent with the local provider

In the UI:

- Select provider: `Local OpenAI-compatible` (or `Local model` in evaluation view)
- API key can be left empty for local mode (unless your server enforces one)
- Optional: set `Model override` to the exact model name your local server expects

### 5. Quick connectivity checks (optional)

```bash
# Backend health
curl http://localhost:8080/health

# Local model endpoint health (replace port/path for your server)
curl http://localhost:8001/v1/models
```
