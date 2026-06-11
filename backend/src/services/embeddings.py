"""
Behavioral journey embeddings.

Each journey is encoded as a 16-dimensional L2-normalised feature vector
capturing the action distribution, navigation pattern, and spatial behaviour
of the navigator (agent or human). Cosine similarity between two normalised
vectors equals their dot product.

Dimensions (16 total):
  0-9  : normalised action-type histogram (10 known action types)
  10   : log-normalised step count
  11   : URL diversity  (unique URLs / total steps)
  12   : backtrack ratio  (go_back actions / total steps)
  13   : scroll ratio  (scroll actions / total steps)
  14   : mean click x  (fraction of screen width, 0-1)
  15   : mean click y  (fraction of screen height, 0-1)
"""

import math
from collections.abc import Sequence

KNOWN_ACTIONS: list[str] = [
    "click",
    "type",
    "go_to_url",
    "scroll",
    "extract_content",
    "done",
    "go_back",
    "wait",
    "screenshot",
    "unknown",
]
_ACTION_INDEX: dict[str, int] = {a: i for i, a in enumerate(KNOWN_ACTIONS)}
EMBEDDING_DIM = 16


def journey_embedding(steps: list[dict]) -> list[float]:
    """Return a 16-dim L2-normalised feature vector for a journey."""
    n = len(steps)
    if n == 0:
        return [0.0] * EMBEDDING_DIM

    # 10-dim action histogram
    counts = [0] * len(KNOWN_ACTIONS)
    for s in steps:
        a = str(s.get("action_type") or "unknown").lower()
        idx = _ACTION_INDEX.get(a, _ACTION_INDEX["unknown"])
        counts[idx] += 1
    hist = [c / n for c in counts]

    # log-normalised step count  (log2(n+1) / log2(51), capped at 1)
    step_feat = min(math.log2(n + 1) / math.log2(51), 1.0)

    # URL diversity
    urls = [s.get("url") or "" for s in steps]
    url_diversity = len(set(urls)) / n

    # backtrack ratio
    backtrack = counts[_ACTION_INDEX["go_back"]] / n

    # scroll ratio
    scroll = counts[_ACTION_INDEX["scroll"]] / n

    # mean click position (only steps that have element_coordinates)
    xs = [s["element_coordinates"]["x"] / 100.0 for s in steps if s.get("element_coordinates")]
    ys = [s["element_coordinates"]["y"] / 100.0 for s in steps if s.get("element_coordinates")]
    mean_x = sum(xs) / len(xs) if xs else 0.5
    mean_y = sum(ys) / len(ys) if ys else 0.5

    vec: list[float] = hist + [step_feat, url_diversity, backtrack, scroll, mean_x, mean_y]
    assert len(vec) == EMBEDDING_DIM

    # L2 normalise so dot product == cosine similarity
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]

    return vec


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity between two vectors (assumed L2-normalised → just dot product)."""
    return round(sum(x * y for x, y in zip(a, b, strict=False)), 4)


def similarity_matrix(
    agent_embeddings: list[list[float]],
    human_embeddings: list[list[float]],
) -> list[list[float]]:
    """Return an (n_agents × n_humans) cosine similarity matrix."""
    return [
        [cosine_similarity(a, h) for h in human_embeddings]
        for a in agent_embeddings
    ]
