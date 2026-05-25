"""
URL → page type classifier.

Two-stage approach:
  1. Fast keyword/structural rules (handles ~80% of cases clearly)
  2. urlBERT zero-shot classification for ambiguous URLs

The urlBERT model used is a zero-shot NLI pipeline on
'cross-encoder/nli-distilroberta-base' (82MB, runs locally).
We classify by asking "does this URL belong to category X?"
and picking the highest-scoring category.
"""
import re
from typing import Optional
from urllib.parse import urlparse

from model.config import PAGE_TYPES

# ── Rule-based classifier ─────────────────────────────────────────────────────
# Ordered by specificity — first match wins.

_RULES = [
    # (regex on lowercased path,  page_type)
    (r"^/?$",                               "home"),
    (r"/blog/[^/]+",                        "blog_post"),
    (r"/blog/?$",                           "blog_index"),
    (r"/news/[^/]+",                        "blog_post"),
    (r"/(pricing|plans|buy|subscribe)",     "pricing"),
    (r"/(checkout|cart|order|payment)",     "checkout"),
    (r"/(login|signup|account|profile|my-)", "account"),
    (r"/(contact|support|help|feedback)",  "contact"),
    (r"/(about|company|team|careers|jobs)", "about"),
    (r"/(docs|documentation|api|reference|guide)", "docs"),
    (r"/(download|free-trial|trial)",       "download"),
    (r"/(search|find|results)",             "search"),
    (r"/(landing|lp/|campaign/)",           "landing"),
    (r"/products?/[^/]+/[^/]+",            "product_detail"),
    (r"/products?/[^/]+/?$",               "product"),
    (r"/(features?|capabilities|solutions)", "feature"),
]

_COMPILED = [(re.compile(pat, re.I), label) for pat, label in _RULES]


_LOCALE_PREFIX = re.compile(r'^/[a-z]{2}(_[a-z]{2,4})?(?=/)', re.I)

def _strip_locale(path: str) -> str:
    """Remove locale prefix from URL path: /th_th/pricing → /pricing"""
    return _LOCALE_PREFIX.sub('', path)


def rule_classify(url: str) -> Optional[str]:
    """Return page type from rules, or None if ambiguous."""
    try:
        path = urlparse(url).path
    except Exception:
        return "other"
    path = _strip_locale(path)
    for pattern, label in _COMPILED:
        if pattern.search(path):
            return label
    return None


def depth_from_url(url: str) -> int:
    """Count meaningful path segments (after stripping locale prefix)."""
    try:
        path = _strip_locale(urlparse(url).path).strip("/")
    except Exception:
        return 0
    if not path:
        return 0
    return min(len(path.split("/")), 5)


# ── NLI-based classifier (loaded lazily) ─────────────────────────────────────

_nli_pipeline = None
_NLI_MODEL = "cross-encoder/nli-distilroberta-base"

# Candidate labels passed to the NLI zero-shot classifier
_NLI_LABELS = [
    "home page",
    "product overview page",
    "detailed product or feature page",
    "pricing or plans page",
    "blog post or article",
    "blog index or news listing",
    "about or company page",
    "contact or support page",
    "user account or login page",
    "search results page",
    "checkout or purchase page",
    "documentation or API reference",
    "software download page",
    "marketing landing page",
    "other web page",
]

_NLI_LABEL_MAP = {
    "home page":                           "home",
    "product overview page":               "product",
    "detailed product or feature page":    "product_detail",
    "pricing or plans page":               "pricing",
    "blog post or article":                "blog_post",
    "blog index or news listing":          "blog_index",
    "about or company page":               "about",
    "contact or support page":             "contact",
    "user account or login page":          "account",
    "search results page":                 "search",
    "checkout or purchase page":           "checkout",
    "documentation or API reference":      "docs",
    "software download page":              "download",
    "marketing landing page":              "landing",
    "other web page":                      "other",
}


def _load_nli():
    global _nli_pipeline
    if _nli_pipeline is None:
        from transformers import pipeline
        print(f"[URLClassifier] Loading NLI model ({_NLI_MODEL}) — first use only…")
        _nli_pipeline = pipeline(
            "zero-shot-classification",
            model=_NLI_MODEL,
            device=-1,   # CPU
        )
    return _nli_pipeline


def nli_classify(url: str) -> str:
    """Use NLI zero-shot to classify ambiguous URLs."""
    # Feed the URL path as the sequence to classify
    try:
        path = urlparse(url).path
    except Exception:
        path = url
    sequence = f"URL path: {path}"
    pipe = _load_nli()
    result = pipe(sequence, candidate_labels=_NLI_LABELS, multi_label=False)
    best_label = result["labels"][0]
    return _NLI_LABEL_MAP.get(best_label, "other")


# ── Public interface ──────────────────────────────────────────────────────────

class URLClassifier:
    """
    Classify a URL into a PAGE_TYPE and compute its depth.

    Args:
        use_nli: if True, fall back to NLI model for ambiguous URLs.
                 Set False for faster batch processing (rules only).
    """

    def __init__(self, use_nli: bool = True):
        self.use_nli = use_nli

    def classify(self, url: str) -> dict:
        """
        Returns:
            {"page_type": str, "page_depth": int}
        """
        page_type = rule_classify(url)
        if page_type is None:
            page_type = nli_classify(url) if self.use_nli else "other"
        return {
            "page_type":  page_type,
            "page_depth": depth_from_url(url),
        }

    def classify_batch(self, urls: list) -> list:
        """Classify a list of URLs. Returns list of dicts."""
        results = []
        ambiguous = []
        ambiguous_idx = []

        for i, url in enumerate(urls):
            pt = rule_classify(url)
            if pt is not None:
                results.append({"page_type": pt, "page_depth": depth_from_url(url)})
            else:
                results.append(None)
                ambiguous.append(url)
                ambiguous_idx.append(i)

        # Batch NLI for ambiguous URLs
        if ambiguous and self.use_nli:
            pipe = _load_nli()
            paths = [urlparse(u).path for u in ambiguous]
            sequences = [f"URL path: {p}" for p in paths]
            nli_results = pipe(sequences, candidate_labels=_NLI_LABELS,
                               multi_label=False)
            if isinstance(nli_results, dict):
                nli_results = [nli_results]  # single result case
            for i, (url, res) in enumerate(zip(ambiguous, nli_results)):
                pt = _NLI_LABEL_MAP.get(res["labels"][0], "other")
                results[ambiguous_idx[i]] = {
                    "page_type":  pt,
                    "page_depth": depth_from_url(url),
                }

        return results
