"""
CLIP-based screenshot pre-selection with Maximal Marginal Relevance (MMR).

Two selection strategies are provided:

1. ``rank_screenshots`` — pure CLIP cosine-similarity ranking (kept for
   backward compat; rarely called directly).

2. ``mmr_select`` — the primary entry point.  Blends CLIP text-image
   similarity (35 %) with caller-supplied heuristic scores (65 %) for
   relevance, then applies MMR to ensure the chosen screenshots are both
   relevant *and* visually diverse.  This avoids forwarding eight
   near-identical frames to Claude.

Accepts file paths (str) or raw image bytes (bytes) for each candidate —
DB-blob screenshots are supported without writing to disk.

The model is loaded lazily on first use and cached in-process.
Model weights (~340 MB) are stored in HF_HOME (default: /model-cache via the
docker-compose volume, or ~/.cache/huggingface locally).
"""

from __future__ import annotations

import asyncio
import io
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

_CLIP_MODEL = "openai/clip-vit-base-patch32"
# Relevance = CLIP_WEIGHT*clip + HEURISTIC_WEIGHT*heuristic + VISUAL_WEIGHT*visual
# All three must sum to 1.0.
_CLIP_WEIGHT = 0.15
_HEURISTIC_WEIGHT = 0.35
_VISUAL_WEIGHT = 0.50
# MMR trade-off: 1.0 = pure relevance, 0.0 = pure diversity.
_LAMBDA_MIX = 0.6
# Pixel std-dev mapped to visual score [0, 1].
# Images at or above this std-dev score 1.0 (fully rendered).
_CONTENT_STDDEV_MAX = 45.0


@lru_cache(maxsize=1)
def _load_clip():
    """Load CLIP model + processor once per process."""
    from transformers import CLIPModel, CLIPProcessor  # noqa: PLC0415

    logger.info("Loading CLIP model %s …", _CLIP_MODEL)
    processor = CLIPProcessor.from_pretrained(_CLIP_MODEL)
    model = CLIPModel.from_pretrained(_CLIP_MODEL)
    model.eval()
    logger.info("CLIP model loaded.")
    return model, processor


def _load_images(sources: list[str | bytes]) -> tuple[list, list[int]]:
    """Open all readable sources as RGB PIL images; return (images, valid_indices)."""
    from PIL import Image  # noqa: PLC0415

    images: list = []
    valid: list[int] = []
    for i, src in enumerate(sources):
        try:
            if isinstance(src, bytes):
                img = Image.open(io.BytesIO(src)).convert("RGB")
            else:
                img = Image.open(src).convert("RGB")
            images.append(img)
            valid.append(i)
        except Exception:
            continue
    return images, valid


def _to_normed_feat(feat, torch):
    """Unwrap a transformer model-output object to a 2-D embedding tensor and L2-normalise it.

    Some transformers versions return a dataclass instead of a plain Tensor.
    pooler_output (shape [batch, hidden]) is the correct field for CLIP; if absent
    we fall back to feat[0] which is last_hidden_state.  nan_to_num guards against
    zero-norm vectors (e.g. all-blank screenshots) that would produce NaN after division.
    """
    if not isinstance(feat, torch.Tensor):
        p = getattr(feat, "pooler_output", None)
        feat = p if p is not None else feat[0]
    normed = feat / feat.norm(dim=-1, keepdim=True)
    return torch.nan_to_num(normed, nan=0.0)


def _visual_content_score(img) -> float:
    """
    Return a score in [0, 1] proportional to pixel std-dev in greyscale.

    Blank / loading-state screenshots score near 0; fully-rendered pages
    score 1.0.  Used as an explicit additive term in the relevance formula
    so that visual quality has equal standing with CLIP and heuristic signals.
    """
    from PIL import ImageStat  # noqa: PLC0415

    stat = ImageStat.Stat(img.convert("L"))
    return min(stat.stddev[0] / _CONTENT_STDDEV_MAX, 1.0)


def _rank_sync(text: str, sources: list[str | bytes], top_k: int) -> list[int]:
    """
    Rank images by cosine similarity to *text*.
    Each source is either a file path (str) or raw image bytes (bytes).
    Returns up to top_k global indices, sorted best-first.
    """
    import torch  # noqa: PLC0415

    model, processor = _load_clip()
    images, valid = _load_images(sources)

    if not images:
        return list(range(min(top_k, len(sources))))

    with torch.no_grad():
        text_inputs = processor(
            text=[text],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=77,
        )
        image_inputs = processor(images=images, return_tensors="pt")

        text_feat = _to_normed_feat(model.get_text_features(**text_inputs), torch)
        image_feat = _to_normed_feat(model.get_image_features(**image_inputs), torch)

        sims = (image_feat @ text_feat.T).squeeze(-1)

    order = sims.argsort(descending=True).tolist()
    return [valid[i] for i in order][:top_k]


def _mmr_select_sync(
    text: str,
    sources: list[str | bytes],
    heuristic_scores: list[float],
    top_k: int,
    lambda_mix: float = _LAMBDA_MIX,
) -> list[int]:
    """
    Select top_k screenshot indices using Maximal Marginal Relevance.

    Relevance = CLIP_WEIGHT * clip_sim_norm + HEURISTIC_WEIGHT * h_norm
    where clip_sim_norm maps cosine similarity from [-1,1] → [0,1] and
    h_norm normalises heuristic scores relative to the highest score in
    the candidate set.

    MMR then iteratively picks the candidate that maximises:
        lambda_mix * relevance  –  (1 - lambda_mix) * max_sim_to_selected

    This balances semantic/heuristic relevance against visual redundancy.
    Falls back to pure heuristic ordering if CLIP is unavailable.

    Returns original source indices in selection order (best first).
    """
    import torch  # noqa: PLC0415

    model, processor = _load_clip()
    images, valid = _load_images(sources)

    if not images:
        order = sorted(
            range(len(sources)),
            key=lambda i: heuristic_scores[i] if i < len(heuristic_scores) else 0.0,
            reverse=True,
        )
        return order[:top_k]

    with torch.no_grad():
        text_inputs = processor(
            text=[text],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=77,
        )
        image_inputs = processor(images=images, return_tensors="pt")

        text_feat = _to_normed_feat(model.get_text_features(**text_inputs), torch)
        image_feat = _to_normed_feat(model.get_image_features(**image_inputs), torch)

        # clip_sims shape: (N_valid,) — cosine similarity in [-1, 1]
        clip_sims = (image_feat @ text_feat.T).squeeze(-1)

    # Normalise heuristic scores to [0, 1] relative to this candidate set
    h_raw = [heuristic_scores[i] if i < len(heuristic_scores) else 0.0 for i in valid]
    h_max = max(h_raw) if h_raw else 1.0
    h_norm = [s / h_max if h_max > 0 else 0.0 for s in h_raw]

    # Map CLIP cosine sim from [-1, 1] → [0, 1]
    clip_norm = [(clip_sims[j].item() + 1.0) / 2.0 for j in range(len(valid))]

    # Visual content score: 0 for blank/loading frames, 1 for fully-rendered pages.
    vis_scores = [_visual_content_score(images[j]) for j in range(len(valid))]
    logger.debug(
        "visual content scores: %s",
        [(valid[j], round(vis_scores[j], 2)) for j in range(len(valid))],
    )

    # Combined relevance: all three signals are additive with explicit weights.
    # A blank image (vis≈0) loses _VISUAL_WEIGHT from its maximum possible score
    # regardless of how well it scores on CLIP or heuristics.
    relevance: dict[int, float] = {
        orig: (
            _CLIP_WEIGHT * clip_norm[j]
            + _HEURISTIC_WEIGHT * h_norm[j]
            + _VISUAL_WEIGHT * vis_scores[j]
        )
        for j, orig in enumerate(valid)
    }
    valid_to_row: dict[int, int] = {orig: j for j, orig in enumerate(valid)}

    # MMR greedy selection
    selected: list[int] = []
    remaining = list(valid)

    while len(selected) < min(top_k, len(valid)):
        if not selected:
            best = max(remaining, key=lambda i: relevance[i])
        else:
            sel_rows = torch.stack([image_feat[valid_to_row[s]] for s in selected])
            best = None
            best_mmr = float("-inf")
            for i in remaining:
                row = image_feat[valid_to_row[i]]
                sim_to_selected = float((sel_rows @ row).max())
                score = lambda_mix * relevance[i] - (1.0 - lambda_mix) * sim_to_selected
                if score > best_mmr:
                    best_mmr = score
                    best = i
            if best is None:
                break
        selected.append(best)
        remaining.remove(best)

    return selected


async def rank_screenshots(text: str, sources: list[str | bytes], top_k: int = 10) -> list[int]:
    """Async wrapper: run CLIP in thread pool, return top_k indices best-first.

    Each source is a file path (str) or raw image bytes (bytes).
    Falls back to [0 … top_k-1] if CLIP is unavailable (missing deps or error).
    """
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _rank_sync, text, sources, top_k)
    except Exception as exc:
        logger.warning("CLIP ranking failed, using first %d: %s", top_k, exc)
        return list(range(min(top_k, len(sources))))


async def mmr_select(
    text: str,
    sources: list[str | bytes],
    heuristic_scores: list[float],
    top_k: int = 8,
    lambda_mix: float = _LAMBDA_MIX,
) -> list[int]:
    """Select top_k diverse, relevant screenshot indices using MMR + CLIP.

    ``heuristic_scores[i]`` is a non-negative float relevance score for
    ``sources[i]``; higher is better.  Scores need not be normalised.

    Returns original source indices in selection order (best first).
    Falls back to heuristic-only ordering if CLIP is unavailable.
    """
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: _mmr_select_sync(text, sources, heuristic_scores, top_k, lambda_mix),
        )
    except Exception as exc:
        logger.warning("MMR selection failed, falling back to heuristic order: %s", exc)
        order = sorted(
            range(len(sources)),
            key=lambda i: heuristic_scores[i] if i < len(heuristic_scores) else 0.0,
            reverse=True,
        )
        return order[:top_k]
