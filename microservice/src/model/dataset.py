"""
PyTorch datasets for pretraining and fine-tuning.

Session format on disk (JSONL, one session per line):
    {"session_id": "...", "task": "generic", "steps": [
        {"page_type": "home", "page_depth": 0, "element_role": "nav_link", "dest_type": "drill_down"},
        ...
    ], "completed": true}

Each step is encoded as a 4-tuple of integers:
    (page_type_idx, depth_idx, role_idx, dest_idx)
"""
import json
import torch
from torch.utils.data import Dataset
from typing import List, Dict, Optional
from model.config import (
    PAGE_TYPE_TO_IDX, ELEMENT_ROLE_TO_IDX, DEST_TYPE_TO_IDX,
    depth_to_idx,
    BOS_IDX, EOS_IDX, PAD_IDX,
    DEPTH_PAD_IDX, ROLE_PAD_IDX, DEST_PAD_IDX,
)


# ── Step encoding / decoding ───────────────────────────────────────────────────

def encode_step(step: Dict) -> List[int]:
    """Dict step → [page_type_idx, depth_idx, role_idx, dest_idx]"""
    return [
        PAGE_TYPE_TO_IDX.get(step.get("page_type", "other"), PAGE_TYPE_TO_IDX["other"]),
        depth_to_idx(step.get("page_depth", 0)),
        ELEMENT_ROLE_TO_IDX.get(step.get("element_role", "unknown"), ELEMENT_ROLE_TO_IDX["unknown"]),
        DEST_TYPE_TO_IDX.get(step.get("dest_type", "unknown"), DEST_TYPE_TO_IDX["unknown"]),
    ]


BOS_STEP = [BOS_IDX, DEPTH_PAD_IDX, ROLE_PAD_IDX, DEST_PAD_IDX]
EOS_STEP = [EOS_IDX, DEPTH_PAD_IDX, ROLE_PAD_IDX, DEST_PAD_IDX]
PAD_STEP = [PAD_IDX, DEPTH_PAD_IDX, ROLE_PAD_IDX, DEST_PAD_IDX]


# ── Dataset ────────────────────────────────────────────────────────────────────

class SessionDataset(Dataset):
    """
    Loads sessions from a JSONL file.
    Returns (input_steps, target_steps, pad_mask) tensors.

    input_steps:  [BOS, step_0, step_1, ..., step_{n-1}]   length = max_seq_len
    target_steps: [step_0, step_1, ..., step_{n-1}, EOS]   length = max_seq_len
    pad_mask:     bool tensor, True = padding               length = max_seq_len

    Loss is computed only on non-padding target positions.
    """

    def __init__(self, jsonl_path: str, max_seq_len: int = 32,
                 task_filter: Optional[str] = None):
        self.max_seq_len = max_seq_len
        self.sessions: List[List[List[int]]] = []

        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                sess = json.loads(line)
                if task_filter and sess.get("task") != task_filter:
                    continue
                steps = [encode_step(s) for s in sess.get("steps", [])]
                if len(steps) < 2:
                    continue
                self.sessions.append(steps)

    def __len__(self):
        return len(self.sessions)

    def __getitem__(self, idx):
        steps = self.sessions[idx]
        seq_len = self.max_seq_len

        # Build input: [BOS, s0, s1, ..., s_{n-1}]  (truncate if needed)
        inp = [BOS_STEP] + steps[: seq_len - 1]
        # Build target: [s0, s1, ..., s_{n-1}, EOS]
        tgt = steps[: seq_len - 1] + [EOS_STEP]

        # Pad to max_seq_len
        n = len(inp)
        pad_len = seq_len - n
        pad_mask = [False] * n + [True] * pad_len
        inp = inp + [PAD_STEP] * pad_len
        tgt = tgt + [PAD_STEP] * pad_len  # PAD targets will be ignored in loss

        inp_t = torch.tensor(inp, dtype=torch.long)       # (seq_len, 4)
        tgt_t = torch.tensor(tgt, dtype=torch.long)       # (seq_len, 4)
        msk_t = torch.tensor(pad_mask, dtype=torch.bool)  # (seq_len,)

        # Replace PAD targets with -100 so cross_entropy ignores them
        tgt_t[msk_t] = -100

        return inp_t, tgt_t, msk_t
