"""
GPT-style causal transformer for user journey next-step prediction.

Each sequence position represents one navigation step with 4 attributes:
    (page_type, page_depth, element_role, dest_type)

The model predicts all 4 attributes of the NEXT step at each position,
enabling autoregressive generation and per-step surprisal scoring.
"""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from model.config import (
    ModelConfig,
    PAGE_VOCAB_SIZE, DEPTH_VOCAB_SIZE, ROLE_VOCAB_SIZE, DEST_VOCAB_SIZE,
    PAD_IDX, DEPTH_PAD_IDX, ROLE_PAD_IDX, DEST_PAD_IDX,
)


class JourneyTransformer(nn.Module):
    """
    Causal transformer that models sequences of abstract navigation steps.

    Input:  (batch, seq_len, 4)  — integer-encoded step attributes
    Output: dict of logits, each (batch, seq_len, vocab_size)
            logits at position t predict step t+1
    """

    def __init__(self, cfg: ModelConfig = ModelConfig()):
        super().__init__()
        self.cfg = cfg
        d = cfg.d_model

        # ── per-attribute embedding tables ────────────────────────────────────
        self.page_type_emb   = nn.Embedding(PAGE_VOCAB_SIZE,  d, padding_idx=PAD_IDX)
        self.page_depth_emb  = nn.Embedding(DEPTH_VOCAB_SIZE, d, padding_idx=DEPTH_PAD_IDX)
        self.element_role_emb = nn.Embedding(ROLE_VOCAB_SIZE, d, padding_idx=ROLE_PAD_IDX)
        self.dest_type_emb   = nn.Embedding(DEST_VOCAB_SIZE,  d, padding_idx=DEST_PAD_IDX)

        # learned positional embedding
        self.pos_emb = nn.Embedding(cfg.max_seq_len, d)

        self.emb_drop = nn.Dropout(cfg.dropout)
        self.emb_norm = nn.LayerNorm(d)

        # ── transformer layers ─────────────────────────────────────────────────
        layer = nn.TransformerEncoderLayer(
            d_model=d,
            nhead=cfg.n_heads,
            dim_feedforward=cfg.d_ffn,
            dropout=cfg.dropout,
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(
            layer, num_layers=cfg.n_layers, enable_nested_tensor=False
        )

        # ── prediction heads ───────────────────────────────────────────────────
        # each head predicts the corresponding attribute of the next step
        self.head_page_type  = nn.Linear(d, PAGE_VOCAB_SIZE)
        self.head_page_depth = nn.Linear(d, DEPTH_VOCAB_SIZE)
        self.head_role       = nn.Linear(d, ROLE_VOCAB_SIZE)
        self.head_dest       = nn.Linear(d, DEST_VOCAB_SIZE)

        self._init_weights()

    def _init_weights(self):
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.normal_(module.weight, std=0.02)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)
            elif isinstance(module, nn.Embedding):
                nn.init.normal_(module.weight, std=0.02)

    def embed(self, steps: torch.Tensor) -> torch.Tensor:
        """
        steps: (batch, seq_len, 4) — [page_type, depth, role, dest]
        returns: (batch, seq_len, d_model)
        """
        B, T, _ = steps.shape
        pos = torch.arange(T, device=steps.device).unsqueeze(0)  # (1, T)

        x = (self.page_type_emb(steps[..., 0]) +
             self.page_depth_emb(steps[..., 1]) +
             self.element_role_emb(steps[..., 2]) +
             self.dest_type_emb(steps[..., 3]) +
             self.pos_emb(pos))

        return self.emb_norm(self.emb_drop(x))

    @staticmethod
    def causal_mask(seq_len: int, device: torch.device) -> torch.Tensor:
        """Upper-triangular mask — prevents attending to future positions."""
        return torch.triu(
            torch.full((seq_len, seq_len), float("-inf"), device=device),
            diagonal=1,
        )

    def forward(self, steps: torch.Tensor, pad_mask: torch.Tensor = None):
        """
        steps:    (batch, seq_len, 4)
        pad_mask: (batch, seq_len) bool, True = padding position

        Returns dict of logits, each (batch, seq_len, vocab_size).
        Logits at position t predict step t+1.
        """
        x = self.embed(steps)
        mask = self.causal_mask(steps.size(1), steps.device)

        x = self.transformer(x, mask=mask, src_key_padding_mask=pad_mask,
                             is_causal=True)

        return {
            "page_type":    self.head_page_type(x),
            "page_depth":   self.head_page_depth(x),
            "element_role": self.head_role(x),
            "dest_type":    self.head_dest(x),
        }

    def get_layers(self):
        """Return transformer layers as a list (used for layer freezing)."""
        return list(self.transformer.layers)

    def freeze_layers(self, n: int):
        """Freeze the first n transformer layers for fine-tuning."""
        for i, layer in enumerate(self.get_layers()):
            if i < n:
                for p in layer.parameters():
                    p.requires_grad = False

    def unfreeze_all(self):
        for p in self.parameters():
            p.requires_grad = True

    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def journey_loss(logits: dict, targets: torch.Tensor,
                 ignore_index: int = -100) -> torch.Tensor:
    """
    Compute mean cross-entropy loss across all 4 attributes.

    logits:  dict of (batch, seq_len, vocab_size) tensors
    targets: (batch, seq_len, 4)  — shifted by 1 from inputs
    """
    losses = []
    keys = ["page_type", "page_depth", "element_role", "dest_type"]
    for i, key in enumerate(keys):
        B, T, V = logits[key].shape
        loss = F.cross_entropy(
            logits[key].reshape(B * T, V),
            targets[..., i].reshape(B * T),
            ignore_index=ignore_index,
        )
        losses.append(loss)
    return torch.stack(losses).mean()
