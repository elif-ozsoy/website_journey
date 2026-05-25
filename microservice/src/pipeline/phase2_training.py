"""
Phase 2 – Base Model Training
==============================
QLoRA fine-tune Gemma-4 E4B on hydrated Adobe trajectories using
DeepSpeed ZeRO-2 with optimizer states offloaded to 96 GB system RAM.

Architecture
------------
  Base model  : Gemma-4 E4B (loaded in 4-bit via bitsandbytes NF4)
  Adapter     : LoRA rank-16 on all attention + MLP projection layers
  HW strategy : Single RTX 4070 Ti Super (16 GB VRAM) + 96 GB RAM via ZeRO-2

Training signal
---------------
Each sample is a (screenshot, DOM excerpt, goal, action) tuple.
The model receives a multi-modal prompt built as:

  <image>
  Goal: {goal}
  Visible interactive elements (Set-of-Mark):
  {som_description}

  DOM snippet (relevant section):
  {dom_snippet}

  Which element should the agent click next?
  Answer with ONLY the box number.

Target: the SoM box number the human clicked (from action["som_box"]).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

import torch
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm
from transformers import TrainingArguments, Trainer
from unsloth import FastVisionModel
from PIL import Image

from pipeline.config import PipelineConfig

log = logging.getLogger(__name__)

# ── Dataset ───────────────────────────────────────────────────────────────────

MAX_DOM_CHARS  = 2_000    # truncate DOM snippets for prompt length
MAX_SOM_ITEMS  = 40       # list at most N SoM elements in the text prompt


def _som_description(som_map: Dict[str, str]) -> str:
    """Turn som_map into a readable list for the text prompt."""
    lines = []
    for box, sel in list(som_map.items())[:MAX_SOM_ITEMS]:
        lines.append(f"  [{box}] {sel}")
    return "\n".join(lines) if lines else "  (none detected)"


def _dom_snippet(dom_path: str) -> str:
    """Return a truncated body of the DOM for context."""
    try:
        html = Path(dom_path).read_text(encoding="utf-8", errors="replace")
        # Strip script/style tags
        import re
        html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
        # Keep only text-bearing tags
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"\s+", " ", html).strip()
        return html[:MAX_DOM_CHARS]
    except Exception:
        return ""


def build_prompt(goal: str, som_map: Dict[str, str], dom_path: str) -> str:
    return (
        f"Goal: {goal}\n\n"
        f"Visible interactive elements (Set-of-Mark):\n{_som_description(som_map)}\n\n"
        f"DOM context:\n{_dom_snippet(dom_path)}\n\n"
        "Which element should the agent click next?\n"
        "Answer with ONLY the box number."
    )


class TrajectoryDataset(Dataset):
    """
    PyTorch Dataset over hydrated trajectory JSONL.
    Each item is one (step_i, step_i+1 action) pair within a trajectory.
    """

    def __init__(self, jsonl_path: str, processor, max_image_size: int = 224):
        self.processor = processor
        self.max_image_size = max_image_size
        self.samples: List[Dict] = []

        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                goal  = rec["goal"]
                steps = rec["steps"]
                for step in steps:
                    action = step.get("action", {})
                    som_box = action.get("som_box")
                    if som_box is None:
                        continue   # skip steps where we couldn't map the selector
                    self.samples.append({
                        "goal":            goal,
                        "som_map":         step.get("som_map", {}),
                        "dom_path":        step.get("dom_path", ""),
                        "screenshot_path": step.get("screenshot_path", ""),
                        "label":           str(som_box),
                    })

        log.info("TrajectoryDataset: %d samples from %s", len(self.samples), jsonl_path)

    def __len__(self) -> int:
        return len(self.samples)

    def _image_token(self) -> str:
        """Return the processor's image placeholder token string."""
        for attr in ("image_token",):
            tok = getattr(self.processor, attr, None)
            if tok:
                return tok
        tok = getattr(self.processor.tokenizer, "image_token", None)
        if tok:
            return tok
        # Search additional special tokens for anything image-related
        extras = getattr(self.processor.tokenizer, "additional_special_tokens", [])
        for t in extras:
            if "image" in t.lower():
                return t
        return "<image>"  # last-resort default

    def __getitem__(self, idx: int) -> Dict:
        s = self.samples[idx]
        text_prompt = build_prompt(s["goal"], s["som_map"], s["dom_path"])

        # Load screenshot — fall back to a blank image if missing
        try:
            img = Image.open(s["screenshot_path"]).convert("RGB")
            img.thumbnail((self.max_image_size, self.max_image_size), Image.LANCZOS)
        except Exception:
            img = Image.new("RGB", (224, 224), color=(200, 200, 200))

        label = s["label"]

        # Gemma-4 needs the image token prepended so the processor inserts
        # image placeholder tokens into input_ids at the right position.
        image_token = self._image_token()
        text = f"{image_token}\n{text_prompt}\n{label}"

        encoding = self.processor(
            images=img,
            text=text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=False,
        )
        # Squeeze batch dim added by processor
        item = {k: v.squeeze(0) for k, v in encoding.items()}
        item["labels"] = item["input_ids"].clone()
        return item


# ── Model loading ─────────────────────────────────────────────────────────────

def load_model_and_processor(cfg: PipelineConfig):
    """Load model via Unsloth FastVisionModel for optimised 4-bit QLoRA."""
    log.info("Loading model via Unsloth: %s", cfg.vlm_model_id)
    model, processor = FastVisionModel.from_pretrained(
        model_name=cfg.vlm_model_id,
        load_in_4bit=True,
        use_gradient_checkpointing="unsloth",
        trust_remote_code=True,
    )

    model = FastVisionModel.get_peft_model(
        model,
        r=cfg.lora_r,
        lora_alpha=cfg.lora_alpha,
        lora_dropout=cfg.lora_dropout,
        target_modules=cfg.lora_targets,
        bias="none",
        # Skip vision encoder — we only need the LM to learn which box to click
        finetune_vision_layers=False,
        finetune_language_layers=True,
        finetune_attention_modules=True,
        finetune_mlp_modules=True,
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    model.print_trainable_parameters()

    return model, processor


# ── Training entry-point ──────────────────────────────────────────────────────

class VLMTrainer:
    """
    Trains (or continues training) the QLoRA adapter on hydrated trajectories.

    Usage:
        trainer = VLMTrainer(cfg)
        trainer.train(
            train_jsonl="pipeline_data/trajectories/hydrated.jsonl",
            output_adapter_dir="pipeline_data/adapters/v1",
        )
    """

    def __init__(self, cfg: Optional[PipelineConfig] = None):
        self.cfg = cfg or PipelineConfig()
        self.cfg.make_dirs()

    def train(
        self,
        train_jsonl: str,
        output_adapter_dir: Optional[str] = None,
        resume_adapter: Optional[str] = None,
    ) -> str:
        output_adapter_dir = output_adapter_dir or os.path.join(
            self.cfg.adapter_dir, "current"
        )
        os.makedirs(output_adapter_dir, exist_ok=True)

        model, processor = load_model_and_processor(self.cfg)

        if resume_adapter:
            from peft import PeftModel
            log.info("Resuming from adapter: %s", resume_adapter)
            model = PeftModel.from_pretrained(model, resume_adapter, is_trainable=True)

        train_ds = TrajectoryDataset(train_jsonl, processor)
        if len(train_ds) == 0:
            raise ValueError("Training dataset is empty — run phase 1 first.")

        # DataCollator that handles variable-length sequences
        data_collator = _PaddingCollator(processor.tokenizer)

        training_args = TrainingArguments(
            output_dir=output_adapter_dir,
            num_train_epochs=self.cfg.train_epochs,
            per_device_train_batch_size=self.cfg.batch_per_gpu,
            gradient_accumulation_steps=self.cfg.grad_accum,
            learning_rate=self.cfg.train_lr,
            bf16=True,
            fp16=False,
            logging_steps=25,
            save_strategy="epoch",
            save_total_limit=2,
            report_to="none",
            dataloader_num_workers=2,
            remove_unused_columns=False,
            optim="adamw_8bit",
            warmup_steps=5,
            lr_scheduler_type="cosine",
        )

        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=train_ds,
            data_collator=data_collator,
        )

        log.info("Starting QLoRA training …")
        trainer.train()

        # Save the LoRA adapter (not the full model weights)
        log.info("Saving LoRA adapter → %s", output_adapter_dir)
        model.save_pretrained(output_adapter_dir)
        processor.save_pretrained(output_adapter_dir)

        return output_adapter_dir


class _PaddingCollator:
    """Left-pad sequences to the longest in the batch."""

    def __init__(self, tokenizer):
        self.tokenizer = tokenizer

    def __call__(self, features: List[Dict]) -> Dict:
        import torch

        batch_input_ids = [f["input_ids"] for f in features]
        batch_labels    = [f["labels"]    for f in features]
        batch_attn      = [f["attention_mask"] for f in features]

        max_len = max(x.shape[0] for x in batch_input_ids)
        pad_id  = self.tokenizer.pad_token_id or 0

        def _pad(seqs, pad_val):
            out = torch.full((len(seqs), max_len), pad_val, dtype=seqs[0].dtype)
            for i, s in enumerate(seqs):
                out[i, :s.shape[0]] = s
            return out

        batch = {
            "input_ids":      _pad(batch_input_ids, pad_id),
            "attention_mask": _pad(batch_attn, 0),
            "labels":         _pad(batch_labels, -100),
        }

        # Pass through all remaining tensor fields (pixel_values, image_position_ids, etc.)
        # Gemma-4 requires image_position_ids alongside pixel_values.
        for key in set(features[0].keys()) - {"input_ids", "attention_mask", "labels"}:
            values = [f[key] for f in features]
            if not isinstance(values[0], torch.Tensor):
                continue
            try:
                batch[key] = torch.stack(values)
            except RuntimeError:
                pass  # skip if shapes are incompatible

        return batch
