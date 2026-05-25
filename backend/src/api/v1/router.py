from fastapi import APIRouter

from api.v1.routes import analytics, auth, data_collection, dummy, evaluation, explain, journeys, policy, tasks, visualizations

router = APIRouter(prefix="/v1")
router.include_router(dummy.router)
router.include_router(auth.router)
router.include_router(data_collection.router)
router.include_router(data_collection.sites_router)
router.include_router(analytics.router)
router.include_router(tasks.router)
router.include_router(evaluation.router)
router.include_router(visualizations.router)
router.include_router(journeys.router)
router.include_router(policy.router)
router.include_router(explain.router)
