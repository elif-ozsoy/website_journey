"""
Surprisal scoring and anomaly detection for user journeys.

Surprisal score: -log P(step_t | step_0..t-1)
  High surprisal at step t = the model didn't expect this navigation = user confusion.

Journey-level metrics:
  mean_surprisal     — average confusion across the journey
  peak_surprisal     — worst single step
  efficiency_ratio   — optimal_path_len / actual_steps (requires goal info)

Anomaly detection (Mahalanobis distance):
  Fit on embeddings of known-good (completed) journeys.
  Score new journeys by distance from the learned normal cluster.
"""
import math
import json
from typing import List, Dict, Optional, Tuple
import numpy as np
import torch
import torch.nn.functional as F
from model.transformer import JourneyTransformer
from model.dataset import encode_step, BOS_STEP, EOS_STEP, PAD_STEP
from model.config import PAD_IDX, ModelConfig


# ── Surprisal ──────────────────────────────────────────────────────────────────

@torch.no_grad()
def per_step_surprisal(
    model: JourneyTransformer,
    steps: List[Dict],
    device: torch.device = torch.device("cpu"),
) -> List[float]:
    """
    Compute surprisal score for each step in a journey (excluding BOS).

    Returns a list of length len(steps), where score[t] is
    -log P(step_t | BOS, step_0..step_{t-1}).

    Higher = more unexpected = more confusion at that step.
    """
    model.eval()
    encoded = [encode_step(s) for s in steps]

    # Build full sequence: [BOS, s0, s1, ..., s_{n-1}]
    inp = [BOS_STEP] + encoded
    inp_t = torch.tensor([inp], dtype=torch.long, device=device)  # (1, T+1, 4)

    logits = model(inp_t)  # each (1, T+1, vocab)

    scores = []
    for t, step_enc in enumerate(encoded):
        # Logits at position t (= input BOS or step_{t-1}) predict step_t
        log_p_page  = F.log_softmax(logits["page_type"][0, t],    dim=-1)[step_enc[0]]
        log_p_depth = F.log_softmax(logits["page_depth"][0, t],   dim=-1)[step_enc[1]]
        log_p_role  = F.log_softmax(logits["element_role"][0, t], dim=-1)[step_enc[2]]
        log_p_dest  = F.log_softmax(logits["dest_type"][0, t],    dim=-1)[step_enc[3]]

        # Joint log-probability (assuming conditional independence of attributes)
        joint_log_p = (log_p_page + log_p_depth + log_p_role + log_p_dest).item()
        scores.append(-joint_log_p)  # surprisal = negative log-prob

    return scores


def journey_metrics(
    model: JourneyTransformer,
    steps: List[Dict],
    goal_url: Optional[str] = None,
    optimal_steps: Optional[int] = None,
    device: torch.device = torch.device("cpu"),
) -> Dict:
    """
    Compute a full set of metrics for a single journey.

    Returns:
        per_step_surprisal:  list of floats, one per step
        mean_surprisal:      float, average surprisal
        peak_surprisal:      float, max surprisal (worst step)
        peak_step_index:     int, which step had peak surprisal
        n_backtracks:        int, count of back_nav steps
        backtrack_rate:      float, backtracks / total steps
        efficiency_ratio:    float or None (requires optimal_steps)
        confusion_score:     float in [0, 1] — normalized composite
    """
    if not steps:
        return {}

    surprisal = per_step_surprisal(model, steps, device)
    n = len(steps)

    backtracks = sum(1 for s in steps if s.get("dest_type") == "back_nav")

    # Normalize surprisal: soft cap at 20 nats (treat as max confusion)
    norm_surprisal = [min(s, 20.0) / 20.0 for s in surprisal]
    mean_norm = float(np.mean(norm_surprisal))
    backtrack_rate = backtracks / n if n > 0 else 0.0

    # Composite confusion score (equal weight on surprisal + backtracking)
    confusion = 0.6 * mean_norm + 0.4 * min(backtrack_rate * 2, 1.0)

    result = {
        "per_step_surprisal": [round(s, 4) for s in surprisal],
        "mean_surprisal":     round(float(np.mean(surprisal)), 4),
        "peak_surprisal":     round(float(np.max(surprisal)), 4),
        "peak_step_index":    int(np.argmax(surprisal)),
        "n_steps":            n,
        "n_backtracks":       backtracks,
        "backtrack_rate":     round(backtrack_rate, 4),
        "confusion_score":    round(confusion, 4),
    }

    if optimal_steps is not None and optimal_steps > 0:
        result["efficiency_ratio"] = round(optimal_steps / n, 4)

    return result


# ── Journey embedding (for anomaly detection) ─────────────────────────────────

@torch.no_grad()
def journey_embedding(
    model: JourneyTransformer,
    steps: List[Dict],
    device: torch.device = torch.device("cpu"),
) -> np.ndarray:
    """
    Extract a fixed-size journey embedding by mean-pooling
    the transformer's last hidden states over non-padding positions.

    Returns: (d_model,) numpy array
    """
    model.eval()
    encoded = [encode_step(s) for s in steps]
    inp = [BOS_STEP] + encoded + [EOS_STEP]
    inp_t = torch.tensor([inp], dtype=torch.long, device=device)

    # Re-run forward without the prediction heads — just get hidden states
    x = model.embed(inp_t)
    mask = model.causal_mask(inp_t.size(1), device)
    hidden = model.transformer(x, mask=mask, is_causal=True)

    # Mean pool over non-padding positions
    emb = hidden[0].mean(dim=0).cpu().numpy()  # (d_model,)
    return emb


# ── Mahalanobis anomaly detector ──────────────────────────────────────────────

class MahalanobisDetector:
    """
    Fit on embeddings of successful journeys.
    Score new journeys by Mahalanobis distance from the normal cluster.

    Usage:
        detector = MahalanobisDetector()
        detector.fit(embeddings)          # list of (d,) arrays
        score = detector.score(embedding) # scalar — higher = more anomalous
    """

    def __init__(self, reg: float = 1e-4):
        self.reg = reg  # regularization for covariance matrix
        self.mu: Optional[np.ndarray] = None
        self.inv_sigma: Optional[np.ndarray] = None
        self.fitted = False

    def fit(self, embeddings: List[np.ndarray]):
        if len(embeddings) < 2:
            raise ValueError("Need at least 2 embeddings to fit.")
        X = np.stack(embeddings)          # (n, d)
        self.mu = X.mean(axis=0)          # (d,)
        sigma = np.cov(X.T)               # (d, d)
        sigma += self.reg * np.eye(sigma.shape[0])   # regularize
        self.inv_sigma = np.linalg.inv(sigma)
        self.fitted = True

    def score(self, embedding: np.ndarray) -> float:
        """Returns Mahalanobis distance (higher = more anomalous)."""
        if not self.fitted:
            raise RuntimeError("Call fit() first.")
        diff = embedding - self.mu
        return float(diff @ self.inv_sigma @ diff)

    def save(self, path: str):
        np.savez(path, mu=self.mu, inv_sigma=self.inv_sigma)

    def load(self, path: str):
        data = np.load(path)
        self.mu = data["mu"]
        self.inv_sigma = data["inv_sigma"]
        self.fitted = True


# ── Aggregate metrics across a set of tester sessions ─────────────────────────

def site_report(
    model: JourneyTransformer,
    sessions: List[Dict],
    device: torch.device = torch.device("cpu"),
) -> Dict:
    """
    Compute aggregate metrics across all sessions for a site.

    sessions: list of session dicts (same format as JSONL),
              each with 'task', 'steps', 'completed' fields.

    Returns a nested dict:
        per_task → {task_name → aggregate metrics}
        site     → {overall metrics}
        friction_pages → list of (page_type, mean_surprisal) sorted desc
    """
    from collections import defaultdict

    task_sessions = defaultdict(list)
    for sess in sessions:
        task_sessions[sess.get("task", "unknown")].append(sess)

    per_task = {}
    all_surprisals = []
    page_surprisals = defaultdict(list)  # page_type → list of surprisal scores

    for task, task_sess in task_sessions.items():
        completion_rate = np.mean([s.get("completed", False) for s in task_sess])
        all_step_surprisals = []
        all_confusion = []

        for sess in task_sess:
            steps = sess.get("steps", [])
            if not steps:
                continue
            m = journey_metrics(model, steps, device=device)
            all_step_surprisals.extend(m["per_step_surprisal"])
            all_confusion.append(m["confusion_score"])
            all_surprisals.extend(m["per_step_surprisal"])

            # collect per-page surprisals
            for step, s in zip(steps, m["per_step_surprisal"]):
                page_surprisals[step.get("page_type", "other")].append(s)

        per_task[task] = {
            "n_sessions":        len(task_sess),
            "completion_rate":   round(float(completion_rate), 3),
            "mean_confusion":    round(float(np.mean(all_confusion)), 3) if all_confusion else None,
            "mean_surprisal":    round(float(np.mean(all_step_surprisals)), 3) if all_step_surprisals else None,
        }

    friction_pages = sorted(
        [(pt, round(float(np.mean(vals)), 3)) for pt, vals in page_surprisals.items()],
        key=lambda x: x[1], reverse=True
    )

    site_confusion = np.mean([v["mean_confusion"] for v in per_task.values()
                               if v["mean_confusion"] is not None])

    return {
        "per_task":       per_task,
        "site_confusion": round(float(site_confusion), 3) if per_task else None,
        "friction_pages": friction_pages,
    }
