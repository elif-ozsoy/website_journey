"""
CLIP-based screenshot pre-selection.

Embeds a UX issue description and all candidate screenshot images into the
same vector space using openai/clip-vit-base-patch32, then ranks by cosine
similarity. This lets the /select-screenshot endpoint receive all available
screenshots and still only forward the top-6 most relevant images to Claude.

The model is loaded lazily on first use and cached in-process.
Model weights (~340 MB) are stored in HF_HOME (default: /model-cache via the
docker-compose volume, or ~/.cache/huggingface locally).
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

_CLIP_MODEL = "openai/clip-vit-base-patch32"


@lru_cache(maxsize=1)
def _load_clip():
    """Load CLIP model + processor once per process."""
    from transformers import CLIPModel, CLIPProcessor  # noqa: PLC0415
    import torch  # noqa: PLC0415

    logger.info("Loading CLIP model %s …", _CLIP_MODEL)
    processor = CLIPProcessor.from_pretrained(_CLIP_MODEL)
    model = CLIPModel.from_pretrained(_CLIP_MODEL)
    model.eval()
    logger.info("CLIP model loaded.")
    return model, processor


def _rank_sync(text: str, paths: list[str], top_k: int) -> list[int]:
    """
    Rank images at *paths* by cosine similarity to *text*.
    Returns up to top_k global indices into paths, sorted best-first.
    """
    from PIL import Image  # noqa: PLC0415
    import torch  # noqa: PLC0415

    model, processor = _load_clip()

    images: list = []
    valid: list[int] = []
    for i, p in enumerate(paths):
        try:
            images.append(Image.open(p).convert("RGB"))
            valid.append(i)
        except Exception:
            continue

    if not images:
        return list(range(min(top_k, len(paths))))

    with torch.no_grad():
        text_inputs = processor(
            text=[text],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=77,
        )
        image_inputs = processor(images=images, return_tensors="pt")

        text_feat = model.get_text_features(**text_inputs)
        image_feat = model.get_image_features(**image_inputs)

        text_feat = text_feat / text_feat.norm(dim=-1, keepdim=True)
        image_feat = image_feat / image_feat.norm(dim=-1, keepdim=True)

        sims = (image_feat @ text_feat.T).squeeze(-1)

    order = sims.argsort(descending=True).tolist()
    return [valid[i] for i in order][:top_k]


async def rank_screenshots(text: str, image_paths: list[str], top_k: int = 6) -> list[int]:
    """Async wrapper: run CLIP in thread pool, return top_k indices best-first.

    Falls back to [0 … top_k-1] if CLIP is unavailable (missing deps or error).
    """
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _rank_sync, text, image_paths, top_k)
    except Exception as exc:
        logger.warning("CLIP ranking failed, using first %d: %s", top_k, exc)
        return list(range(min(top_k, len(image_paths))))
