"""
Vocabulary definitions and model hyperparameters.
All abstract token types are defined here — single source of truth.
"""
from dataclasses import dataclass, field
from typing import List

# ── Abstract vocabularies ──────────────────────────────────────────────────────

# Page semantic type — assigned by URL classifier
PAGE_TYPES: List[str] = [
    "home",           # root / landing page
    "product",        # product family page  (/products/photoshop)
    "product_detail", # deep product page    (/products/photoshop/features)
    "feature",        # feature description page
    "pricing",        # pricing / plans page
    "blog_post",      # individual blog article
    "blog_index",     # blog listing / category
    "about",          # about / company page
    "contact",        # contact / support
    "account",        # login / account management
    "search",         # search results
    "checkout",       # purchase / checkout flow
    "landing",        # campaign landing page
    "docs",           # documentation
    "download",       # download page
    "other",          # fallback
]

# Page depth in URL hierarchy — bucketed
PAGE_DEPTHS: List[int] = [0, 1, 2, 3, 4, 5]   # 5 means "5 or deeper"

# Element role — assigned by DOM/selector classifier
ELEMENT_ROLES: List[str] = [
    "nav_link",    # top-level navigation link
    "cta",         # primary call-to-action button
    "button",      # generic button (non-CTA)
    "footer_link", # footer navigation link
    "hero",        # hero section element
    "search",      # search bar / search button
    "menu_item",   # dropdown / hamburger menu item
    "image_link",  # clickable image
    "text_link",   # inline text hyperlink
    "form_submit", # form submit button
    "tab",         # tab / accordion toggle
    "breadcrumb",  # breadcrumb navigation link
    "pagination",  # next/prev page link
    "other",       # fallback
    "unknown",     # click_source was null
]

# Destination type — relationship between source and target page
DEST_TYPES: List[str] = [
    "drill_down",    # navigate deeper in hierarchy
    "back_nav",      # navigate shallower / back
    "lateral_nav",   # same depth, different section
    "external_exit", # leave to another domain
    "no_nav",        # click with no target URL (JS action)
    "unknown",       # target URL was null / unresolvable
]

# Special tokens — appended to PAGE_TYPES vocab
SPECIAL_TOKENS: List[str] = ["[PAD]", "[BOS]", "[EOS]"]

PAD_IDX  = len(PAGE_TYPES)      # 16
BOS_IDX  = len(PAGE_TYPES) + 1  # 17
EOS_IDX  = len(PAGE_TYPES) + 2  # 18
PAGE_VOCAB_SIZE = len(PAGE_TYPES) + len(SPECIAL_TOKENS)  # 19

DEPTH_VOCAB_SIZE = len(PAGE_DEPTHS) + 1   # +1 for PAD (index 6)
ROLE_VOCAB_SIZE  = len(ELEMENT_ROLES) + 1 # +1 for PAD (index 15)
DEST_VOCAB_SIZE  = len(DEST_TYPES) + 1    # +1 for PAD (index 6)

DEPTH_PAD_IDX = len(PAGE_DEPTHS)
ROLE_PAD_IDX  = len(ELEMENT_ROLES)
DEST_PAD_IDX  = len(DEST_TYPES)

# Convenience: string → index lookups
PAGE_TYPE_TO_IDX  = {t: i for i, t in enumerate(PAGE_TYPES)}
ELEMENT_ROLE_TO_IDX = {r: i for i, r in enumerate(ELEMENT_ROLES)}
DEST_TYPE_TO_IDX  = {d: i for i, d in enumerate(DEST_TYPES)}

PAGE_TYPE_TO_IDX["[PAD]"] = PAD_IDX
PAGE_TYPE_TO_IDX["[BOS]"] = BOS_IDX
PAGE_TYPE_TO_IDX["[EOS]"] = EOS_IDX


def depth_to_idx(depth: int) -> int:
    return min(depth, 5)


# ── Model hyperparameters ──────────────────────────────────────────────────────

@dataclass
class ModelConfig:
    d_model:      int = 128   # embedding dimension
    n_heads:      int = 4     # attention heads
    n_layers:     int = 6     # transformer layers
    d_ffn:        int = 256   # feedforward hidden dim
    dropout:      float = 0.1
    max_seq_len:  int = 32    # max steps per journey


@dataclass
class TrainConfig:
    # pretraining
    pretrain_epochs:    int   = 10
    pretrain_lr:        float = 3e-4
    pretrain_batch:     int   = 256
    pretrain_warmup:    int   = 1000

    # fine-tuning
    finetune_epochs:    int   = 20
    finetune_lr:        float = 1e-4
    finetune_batch:     int   = 32
    frozen_layers:      int   = 4    # freeze first N transformer layers

    # session reconstruction
    n_synthetic_sessions: int = 500_000
    min_session_len:      int = 3
    max_session_len:      int = 20

    # paths
    data_dir:     str = "ETH-IML-Course-Datasets"
    sessions_dir: str = "sessions"
    ckpt_dir:     str = "checkpoints"


DEFAULT_MODEL  = ModelConfig()
DEFAULT_TRAIN  = TrainConfig()
