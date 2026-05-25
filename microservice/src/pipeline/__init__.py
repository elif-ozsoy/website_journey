"""
CipherCorgi VLM pipeline — four-phase system:

  Phase 1 – Data Hydration  : Adobe URLs → screenshots (SoM) + DOM + inferred goals
  Phase 2 – VLM Training    : QLoRA fine-tune Gemma-4 E4B with DeepSpeed ZeRO-2
  Phase 3 – Evaluator       : Browser-Use agent + UX/accessibility metrics
  Phase 4 – Data Flywheel   : Nightly QLoRA updates from human data + replay buffer
"""
