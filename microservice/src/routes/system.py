from fastapi import APIRouter
from fastapi_versioning import version

router = APIRouter(prefix="/system", tags=["System"])


@router.get("/health")
@version(1)
async def health():
    return {"status": "ok", "service": "microservice"}


@router.get("/gpu")
@version(1)
async def gpu_info():
    try:
        import torch
        return {
            "available": torch.cuda.is_available(),
            "device_count": torch.cuda.device_count(),
            "devices": [torch.cuda.get_device_name(i)
                        for i in range(torch.cuda.device_count())],
        }
    except ImportError:
        return {"available": False, "reason": "torch not installed"}
