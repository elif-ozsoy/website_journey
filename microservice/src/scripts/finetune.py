"""
Fine-tune a pretrained JourneyTransformer on tester sessions for a new site.

Freezes the first N transformer layers (preserving general navigation patterns),
updates only the last layers + prediction heads.

Tester sessions should be in JSONL format (see README.md).

Usage:
    conda run -n xaiml python scripts/finetune.py \
        --pretrained checkpoints/pretrain_best.pt \
        --sessions   tester_sessions/acme_sessions.jsonl \
        --output-dir checkpoints/acme \
        --task       find_pricing
"""
import os
import json
import argparse

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from tqdm import tqdm

from model.transformer import JourneyTransformer, journey_loss
from model.dataset import SessionDataset
from model.metrics import journey_embedding, MahalanobisDetector
from model.config import ModelConfig, DEFAULT_TRAIN


def evaluate(model, loader, device):
    model.eval()
    total_loss = 0.0
    n = 0
    with torch.no_grad():
        for inp, tgt, msk in loader:
            inp, tgt, msk = inp.to(device), tgt.to(device), msk.to(device)
            loss = journey_loss(model(inp, pad_mask=msk), tgt)
            total_loss += loss.item()
            n += 1
    return total_loss / max(n, 1)


def main():
    parser = argparse.ArgumentParser(description="Fine-tune JourneyTransformer on tester sessions")
    parser.add_argument("--pretrained",    required=True,  help="Path to pretrain_best.pt")
    parser.add_argument("--sessions",      required=True,  help="Path to tester sessions JSONL")
    parser.add_argument("--output-dir",    required=True,  help="Where to save fine-tuned checkpoint")
    parser.add_argument("--task",          default=None,   help="Filter sessions by task name")
    parser.add_argument("--epochs",        type=int,   default=DEFAULT_TRAIN.finetune_epochs)
    parser.add_argument("--batch-size",    type=int,   default=DEFAULT_TRAIN.finetune_batch)
    parser.add_argument("--lr",            type=float, default=DEFAULT_TRAIN.finetune_lr)
    parser.add_argument("--frozen-layers", type=int,   default=DEFAULT_TRAIN.frozen_layers)
    parser.add_argument("--val-split",     type=float, default=0.15)
    parser.add_argument("--max-seq-len",   type=int,   default=32)
    parser.add_argument("--fit-detector",  action="store_true",
                        help="Fit Mahalanobis anomaly detector after fine-tuning")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    os.makedirs(args.output_dir, exist_ok=True)

    # ── Load pretrained model ──────────────────────────────────────────────────
    ckpt = torch.load(args.pretrained, map_location=device)
    cfg  = ModelConfig(**ckpt["config"])
    model = JourneyTransformer(cfg).to(device)
    model.load_state_dict(ckpt["model"])
    print(f"Loaded pretrained model from {args.pretrained}")

    # Freeze early layers
    model.freeze_layers(args.frozen_layers)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Frozen first {args.frozen_layers} layers. "
          f"Trainable parameters: {trainable:,} / {model.num_parameters():,}")

    # ── Dataset ────────────────────────────────────────────────────────────────
    full_ds = SessionDataset(args.sessions, max_seq_len=args.max_seq_len,
                             task_filter=args.task)
    if len(full_ds) == 0:
        raise ValueError(f"No sessions found in {args.sessions} "
                         f"(task_filter={args.task!r})")
    print(f"Sessions loaded: {len(full_ds)}")

    n_val   = max(1, int(len(full_ds) * args.val_split))
    n_train = len(full_ds) - n_val
    train_ds, val_ds = random_split(full_ds, [n_train, n_val],
                                    generator=torch.Generator().manual_seed(42))

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size * 2, shuffle=False)

    # ── Optimiser ──────────────────────────────────────────────────────────────
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.lr, weight_decay=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.1,
    )

    # ── Fine-tuning loop ───────────────────────────────────────────────────────
    log = []
    best_val_loss = float("inf")
    best_state    = None

    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0
        n_batches  = 0

        pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{args.epochs}")
        for inp, tgt, msk in pbar:
            inp, tgt, msk = inp.to(device), tgt.to(device), msk.to(device)
            optimizer.zero_grad()
            loss = journey_loss(model(inp, pad_mask=msk), tgt)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            epoch_loss += loss.item()
            n_batches  += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")

        scheduler.step()
        avg_train = epoch_loss / n_batches
        avg_val   = evaluate(model, val_loader, device)

        entry = {
            "epoch":      epoch + 1,
            "train_loss": round(avg_train, 5),
            "val_loss":   round(avg_val,   5),
            "lr":         round(scheduler.get_last_lr()[0], 7),
        }
        log.append(entry)
        print(json.dumps(entry))

        if avg_val < best_val_loss:
            best_val_loss = avg_val
            best_state    = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    # Save best fine-tuned checkpoint
    final_ckpt = {
        "model":       best_state,
        "config":      cfg.__dict__,
        "task":        args.task,
        "val_loss":    best_val_loss,
        "frozen_layers": args.frozen_layers,
    }
    ckpt_path = os.path.join(args.output_dir, "finetune_best.pt")
    torch.save(final_ckpt, ckpt_path)
    print(f"\nSaved best fine-tuned checkpoint → {ckpt_path}")

    with open(os.path.join(args.output_dir, "finetune_log.json"), "w") as f:
        json.dump(log, f, indent=2)

    # ── Fit anomaly detector ───────────────────────────────────────────────────
    if args.fit_detector:
        print("\nFitting Mahalanobis anomaly detector on successful sessions…")
        model.load_state_dict({k: v.to(device) for k, v in best_state.items()})
        model.eval()

        # Load raw sessions (not the PyTorch dataset) to access step dicts
        with open(args.sessions) as f:
            raw_sessions = [json.loads(l) for l in f if l.strip()]

        if args.task:
            raw_sessions = [s for s in raw_sessions if s.get("task") == args.task]

        successful = [s for s in raw_sessions if s.get("completed", False)]
        if len(successful) < 2:
            print("  Not enough successful sessions to fit detector — skipping.")
        else:
            embeddings = [
                journey_embedding(model, s["steps"], device=device)
                for s in tqdm(successful, desc="  Embedding")
            ]
            detector = MahalanobisDetector()
            detector.fit(embeddings)
            det_path = os.path.join(args.output_dir, "anomaly_detector.npz")
            detector.save(det_path)
            print(f"  Detector saved → {det_path}")
            print(f"  Fitted on {len(successful)} successful sessions.")


if __name__ == "__main__":
    main()
