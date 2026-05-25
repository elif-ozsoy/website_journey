from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware import Middleware

from api.routes.agent_ws import router as agent_ws_router
from api.routes.proxy import router as proxy_router
from api.routes.screenshots import router as screenshots_router
from api.routes.screenshots import v1_router as screenshots_v1_router
from api.routes.tracking import _finished_router, router as tracking_router
from api.v1.router import router as v1_router
from core.config import settings
from db.init_db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    import time, logging
    for attempt in range(1, 21):
        try:
            init_db()
            break
        except Exception as exc:
            logging.warning(f"DB init attempt {attempt}/20 failed: {exc}. Retrying in 5s…")
            if attempt == 20:
                logging.error("DB init failed after 20 attempts — starting anyway, will retry on first request")
            else:
                time.sleep(5)

    # One shared HTTP client for the whole app — reuses connections across
    # all proxied requests instead of doing TCP+TLS handshakes per asset.
    app.state.http_client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=60.0),
        limits=httpx.Limits(
            max_connections=200,
            max_keepalive_connections=50,
            keepalive_expiry=30.0,
        ),
        http2=True,  # requires `pip install httpx[http2]`
    )
    try:
        yield
    finally:
        await app.state.http_client.aclose()


cors_middleware = Middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = FastAPI(
    title="XAI/IML'26 Backend API",
    version="1.0.0",
    middleware=[cors_middleware],
    lifespan=lifespan,
)

app.include_router(v1_router)
app.include_router(screenshots_v1_router)
app.include_router(agent_ws_router)
app.include_router(proxy_router)
app.include_router(tracking_router)
app.include_router(screenshots_router)
app.include_router(_finished_router)


@app.get("/health", tags=["Monitoring"])
async def health():
    return {"status": "ok"}