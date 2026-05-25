# VLM Training Guide

## What Is Being Trained

**Gemma-4 E4B** — a 4-billion parameter Vision Language Model fine-tuned via **QLoRA** to act as a web navigation agent. Given a screenshot of a webpage (with numbered bounding boxes overlaid on interactive elements) plus a user goal and DOM context, it predicts which element number to click next.

Only the LoRA adapter weights are saved (~2.2M params), not the full 4B model. The base model stays frozen.

---

## Prerequisites

Data generation (Phase 1 hydration) must already be complete. You should have:

```
pipeline_data/trajectories/hydrated.jsonl
pipeline_data/screenshots/          ← PNG screenshots
pipeline_data/doms/                  ← HTML snapshots
```

If not, run hydration first:
```bash
conda run -n xaiml python microservice/src/scripts/hydrate.py \
    --parquet research/data/adobe.parquet
```

---

## Training Command (Phase 2)

All commands run from the **project root** (`CipherCorgi/`), not from inside `microservice/`:

```bash
conda run -n xaiml torchrun --nproc_per_node=1 \
    microservice/src/scripts/train_vlm.py \
    --train-jsonl pipeline_data/trajectories/hydrated.jsonl \
    --output-dir pipeline_data/adapters/v1
```

This will:
1. Load `google/gemma-4-E4B` in 4-bit NF4 quantization
2. Attach LoRA adapters (r=16, α=32) to attention + MLP layers
3. Train for 3 epochs with DeepSpeed ZeRO-2 (CPU optimizer offload)
4. Save the adapter to `pipeline_data/adapters/v1/`

Expected VRAM usage: ~14 GB (fits on RTX 4070 Ti Super 16 GB)

---

## Key Hyperparameters

| Parameter | Default | Flag to override |
|-----------|---------|-----------------|
| Epochs | 3 | `--epochs 5` |
| Learning rate | 2e-4 | `--lr 1e-4` |
| LoRA rank | 16 | `--lora-r 32` |
| LoRA alpha | 32 | `--lora-alpha 64` |
| Batch per GPU | 1 | `--batch-per-gpu 2` |
| Gradient accumulation | 8 | `--grad-accum 4` |

Effective batch size = `batch-per-gpu × grad-accum` = **8** by default.

---

## Resume from Checkpoint

```bash

```

---

## After Training: Evaluate

Test the adapter on a real website:

```bash
conda run -n xaiml python src/scripts/run_evaluator.py \
    --adapter pipeline_data/adapters/v1 \
    --goal "Find Creative Cloud pricing" \
    --url "https://www.adobe.com" \
    --output-dir pipeline_data/eval_reports
```

Or run batch evaluation from a JSONL file of `{goal, url}` pairs:

```bash
conda run -n xaiml python src/scripts/run_evaluator.py \
    --adapter pipeline_data/adapters/v1 \
    --goals-file goals.jsonl \
    --output-dir pipeline_data/eval_reports
```

Reports are saved as `pipeline_data/eval_reports/session_{timestamp}/report.json` and include:
- `completed` — whether the goal was achieved
- `total_steps` / `backtrack_rate` — navigation efficiency
- `cognitive_load_score` — composite UX friction score
- `a11y_violations` — WCAG issues found (axe-core + VLM visual check)

---

## Full Pipeline (all 4 phases)

```bash
# Phase 1: Hydrate raw click data → multi-modal trajectories
conda run -n xaiml python src/scripts/hydrate.py \
    --parquet research/data/adobe.parquet

# Phase 2: Train Gemma-4 E4B
conda run -n xaiml torchrun --nproc_per_node=1 \
    src/scripts/train_vlm.py \
    --train-jsonl pipeline_data/trajectories/hydrated.jsonl \
    --output-dir pipeline_data/adapters/v1

# Phase 3: Evaluate
conda run -n xaiml python src/scripts/run_evaluator.py \
    --adapter pipeline_data/adapters/v1 \
```

---

## Data Format (what the model sees during training)

Each training sample is built from one step in a hydrated trajectory:

```
Goal: Upgrade Creative Cloud subscription

Visible interactive elements (Set-of-Mark):
  [3] a.nav__link
  [14] button.cta-primary
  ...

DOM context:
<truncated HTML snippet>

Which element should the agent click next?
Answer with ONLY the box number.
```

The model is trained to output a single integer — the SoM box number of the correct element.
# VLM Training Guide

## What Is Being Trained

**Gemma-4 E4B** — a 4-billion parameter Vision Language Model fine-tuned via **QLoRA** to act as a web navigation agent. Given a screenshot of a webpage (with numbered bounding boxes overlaid on interactive elements) plus a user goal and DOM context, it predicts which element number to click next.
