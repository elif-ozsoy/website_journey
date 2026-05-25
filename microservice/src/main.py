import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_versioning import version, VersionedFastAPI
from starlette.middleware import Middleware

from routes.debug import router as debug_router
from routes.dummy import router as dummy_router
from routes.inference import router as inference_router
from routes.system import router as system_router

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

cors_middleware = Middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# The call to VersionedFastAPI() must receive the same parameters as FastAPI().
# See: https://github.com/DeanWay/fastapi-versioning#extra-fastapi-constructor-arguments
fastapi_args = {
    "version": "1.0.0",
    "middleware": [cors_middleware],
}

app = FastAPI(title="XAI/IML'26 Microservice API", **fastapi_args)

app.include_router(dummy_router)
app.include_router(system_router)
app.include_router(inference_router)
app.include_router(debug_router)

app = VersionedFastAPI(app,
                       **fastapi_args,
                       version_format='{major}',
                       prefix_format='/v{major}',
                       enable_latest=True)


##################################################################
# THE FOLLOWING ENDPOINTS SHOULD BE UNVERSIONED, AND, THEREFORE, #
# HAVE TO BE DECLARED AFTER THE CALL TO VersionedFastAPI()       #
##################################################################

@app.get("/health", tags=["Monitoring"])
@version(0)
async def health():
    return {"status": "ok"}
