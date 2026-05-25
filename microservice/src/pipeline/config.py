"""
Central configuration for the VLM pipeline.
All paths / hyper-parameters can be overridden via environment variables or
passed directly when constructing a pipeline object.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


# ── Model ─────────────────────────────────────────────────────────────────────

# Gemma-4 E4B on HuggingFace.  Update this ID once the official release lands.
# DEFAULT_VLM_MODEL_ID = os.getenv("VLM_MODEL_ID", "google/gemma-3-4b-it")
DEFAULT_VLM_MODEL_ID = "unsloth/gemma-4-e4b-unsloth-bnb-4bit"

# LoRA hyper-parameters
LORA_R        = int(os.getenv("LORA_R", "16"))
LORA_ALPHA    = int(os.getenv("LORA_ALPHA", "32"))
LORA_DROPOUT  = float(os.getenv("LORA_DROPOUT", "0.05"))
LORA_TARGETS  = ["q_proj", "k_proj", "v_proj", "o_proj",
                 "gate_proj", "up_proj", "down_proj"]

# Quantisation
QUANT_BITS    = int(os.getenv("QUANT_BITS", "4"))   # 4-bit QLoRA

# Training
TRAIN_EPOCHS         = int(os.getenv("TRAIN_EPOCHS", "3"))
TRAIN_LR             = float(os.getenv("TRAIN_LR", "2e-4"))
TRAIN_BATCH_PER_GPU  = int(os.getenv("TRAIN_BATCH_PER_GPU", "1"))
GRAD_ACCUM_STEPS     = int(os.getenv("GRAD_ACCUM_STEPS", "8"))
REPLAY_BUFFER_RATIO  = float(os.getenv("REPLAY_BUFFER_RATIO", "0.07"))  # 7 %

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR         = os.getenv("PIPELINE_BASE_DIR", "pipeline_data")
SCREENSHOTS_DIR  = os.path.join(BASE_DIR, "screenshots")
DOMS_DIR         = os.path.join(BASE_DIR, "doms")
TRAJECTORIES_DIR = os.path.join(BASE_DIR, "trajectories")
ADAPTER_DIR      = os.path.join(BASE_DIR, "adapters")
HUMAN_DATA_DIR   = os.path.join(BASE_DIR, "human_trajectories")
REPLAY_BUFFER    = os.path.join(BASE_DIR, "replay_buffer.jsonl")
DEEPSPEED_CONFIG = os.path.join(
    os.path.dirname(__file__), "..", "..", "deepspeed_zero2.json"
)

# ── LLM goal inference ────────────────────────────────────────────────────────

GOAL_INFERENCE_MODEL = os.getenv("GOAL_LLM_MODEL", "claude-haiku-4-5-20251001")

# ── Accessibility ─────────────────────────────────────────────────────────────

AXE_CORE_CDN = (
    "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js"
)

# ── Wayback Machine ───────────────────────────────────────────────────────────

WAYBACK_CDX_API = "https://web.archive.org/cdx/search/cdx"
WAYBACK_BASE    = "https://web.archive.org/web"


@dataclass
class PipelineConfig:
    """Mutable config object — override any field at call-site."""
    vlm_model_id:       str   = DEFAULT_VLM_MODEL_ID
    lora_r:             int   = LORA_R
    lora_alpha:         int   = LORA_ALPHA
    lora_dropout:       float = LORA_DROPOUT
    lora_targets:       list  = field(default_factory=lambda: LORA_TARGETS)
    quant_bits:         int   = QUANT_BITS
    train_epochs:       int   = TRAIN_EPOCHS
    train_lr:           float = TRAIN_LR
    batch_per_gpu:      int   = TRAIN_BATCH_PER_GPU
    grad_accum:         int   = GRAD_ACCUM_STEPS
    replay_ratio:       float = REPLAY_BUFFER_RATIO
    base_dir:           str   = BASE_DIR
    screenshots_dir:    str   = SCREENSHOTS_DIR
    doms_dir:           str   = DOMS_DIR
    trajectories_dir:   str   = TRAJECTORIES_DIR
    adapter_dir:        str   = ADAPTER_DIR
    human_data_dir:     str   = HUMAN_DATA_DIR
    replay_buffer_path: str   = REPLAY_BUFFER
    deepspeed_config:   str   = DEEPSPEED_CONFIG
    goal_llm_model:     str   = GOAL_INFERENCE_MODEL

    def make_dirs(self) -> None:
        for d in [
            self.screenshots_dir, self.doms_dir,
            self.trajectories_dir, self.adapter_dir,
            self.human_data_dir,
        ]:
            os.makedirs(d, exist_ok=True)
