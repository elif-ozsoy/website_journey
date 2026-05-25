"""
Phase 2 CLI – QLoRA Fine-Tuning

Fine-tunes Gemma-4 E4B on hydrated Adobe trajectories using DeepSpeed ZeRO-2
with optimizer states offloaded to system RAM.

Usage:
    conda run -n xaiml torchrun --nproc_per_node=1 scripts/train_vlm.py \
        --train-jsonl pipeline_data/trajectories/hydrated.jsonl \
        --output-dir  pipeline_data/adapters/v1

    # Resume from an existing adapter checkpoint:
    conda run -n xaiml torchrun --nproc_per_node=1 scripts/train_vlm.py \
        --train-jsonl pipeline_data/trajectories/hydrated.jsonl \
        --output-dir  pipeline_data/adapters/v2 \
        --resume-adapter pipeline_data/adapters/v1

Hardware note:
    DeepSpeed ZeRO-2 config at microservice/deepspeed_zero2.json offloads
    the Adam optimizer states to CPU RAM.  With 4-bit model weights on the
    RTX 4070 Ti Super (16 GB) and optimiser states in 96 GB RAM, the 4B-param
    Gemma model fits comfortably.
"""
import argparse
import logging
import os
import sys

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main():
    parser = argparse.ArgumentParser(description="Phase 2: QLoRA VLM fine-tuning")
    parser.add_argument("--train-jsonl",     required=True,
                        help="Hydrated trajectory JSONL from phase 1")
    parser.add_argument("--output-dir",      default="pipeline_data/adapters/current",
                        help="Directory to save the LoRA adapter")
    parser.add_argument("--resume-adapter",  default=None,
                        help="Path to existing adapter to continue training from")
    parser.add_argument("--model-id",        default=None,
                        help="HuggingFace model ID (overrides config)")
    parser.add_argument("--epochs",          type=int,   default=None)
    parser.add_argument("--lr",              type=float, default=None)
    parser.add_argument("--lora-r",          type=int,   default=None)
    parser.add_argument("--lora-alpha",      type=int,   default=None)
    parser.add_argument("--batch-per-gpu",   type=int,   default=None)
    parser.add_argument("--grad-accum",      type=int,   default=None)
    parser.add_argument("--base-dir",        default="pipeline_data")
    args = parser.parse_args()

    from pipeline.config import PipelineConfig
    from pipeline.phase2_training import VLMTrainer

    cfg = PipelineConfig(base_dir=args.base_dir)
    if args.model_id:     cfg.vlm_model_id   = args.model_id
    if args.epochs:       cfg.train_epochs   = args.epochs
    if args.lr:           cfg.train_lr       = args.lr
    if args.lora_r:       cfg.lora_r         = args.lora_r
    if args.lora_alpha:   cfg.lora_alpha     = args.lora_alpha
    if args.batch_per_gpu: cfg.batch_per_gpu = args.batch_per_gpu
    if args.grad_accum:   cfg.grad_accum     = args.grad_accum

    trainer = VLMTrainer(cfg)
    adapter_dir = trainer.train(
        train_jsonl=args.train_jsonl,
        output_adapter_dir=args.output_dir,
        resume_adapter=args.resume_adapter,
    )
    print(f"Training complete. Adapter saved → {adapter_dir}")


if __name__ == "__main__":
    main()
