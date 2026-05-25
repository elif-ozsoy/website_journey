"""
CSS selector / DOM element → element role classifier.

Same two-stage approach as url_classifier:
  1. Keyword rules on the selector string (fast, ~85% coverage)
  2. NLI zero-shot for ambiguous selectors (same model as URL classifier)
"""
import re
from typing import Optional

# ── Rule-based classifier ─────────────────────────────────────────────────────

_ROLE_RULES = [
    # (regex on lowercased selector string, role)
    (r"(^|\W)(nav|navigation|navbar|nav-bar|main-nav|site-nav)",  "nav_link"),
    (r"(^|\W)(cta|call-to-action|calltoaction|btn-primary|button-primary)", "cta"),
    (r"(^|\W)(hero|banner|jumbotron|masthead)",                   "hero"),
    (r"(^|\W)(footer|foot-|site-footer)",                         "footer_link"),
    (r"(^|\W)(search|searchbar|search-bar|search-box)",           "search"),
    (r"(^|\W)(menu|dropdown|hamburger|mobile-menu|offcanvas)",    "menu_item"),
    (r"(^|\W)(breadcrumb|bread-crumb|crumb)",                     "breadcrumb"),
    (r"(^|\W)(pagination|pager|page-nav|prev|next-page)",         "pagination"),
    (r"(^|\W)(tab|tabs|tabpanel|accordion)",                      "tab"),
    (r"(^|\W)(form|submit|sign-up|signup|register|login-btn)",    "form_submit"),
    (r"img|image|photo|thumbnail|picture",                        "image_link"),
    (r"(^|\W)(btn|button)",                                       "button"),
    (r"<a |href=|link",                                           "text_link"),
]

_COMPILED_ROLE = [(re.compile(pat, re.I), label) for pat, label in _ROLE_RULES]


def rule_classify_selector(selector: Optional[str]) -> Optional[str]:
    """Return element role from rules, or None if selector is null/ambiguous."""
    if selector is None or str(selector).strip() == "":
        return "unknown"
    sel = str(selector).lower()
    for pattern, label in _COMPILED_ROLE:
        if pattern.search(sel):
            return label
    return None


# ── NLI-based classifier ──────────────────────────────────────────────────────

_NLI_ROLE_LABELS = [
    "navigation menu link",
    "primary call-to-action button",
    "generic button",
    "footer link",
    "hero or banner section element",
    "search bar or search button",
    "dropdown or hamburger menu item",
    "clickable image or thumbnail",
    "inline text hyperlink",
    "form submit button",
    "tab or accordion toggle",
    "breadcrumb link",
    "pagination or next page link",
    "other interactive element",
]

_NLI_ROLE_MAP = {
    "navigation menu link":             "nav_link",
    "primary call-to-action button":    "cta",
    "generic button":                   "button",
    "footer link":                      "footer_link",
    "hero or banner section element":   "hero",
    "search bar or search button":      "search",
    "dropdown or hamburger menu item":  "menu_item",
    "clickable image or thumbnail":     "image_link",
    "inline text hyperlink":            "text_link",
    "form submit button":               "form_submit",
    "tab or accordion toggle":          "tab",
    "breadcrumb link":                  "breadcrumb",
    "pagination or next page link":     "pagination",
    "other interactive element":        "other",
}

_nli_pipeline = None
_NLI_MODEL = "cross-encoder/nli-distilroberta-base"


def _load_nli():
    global _nli_pipeline
    if _nli_pipeline is None:
        from transformers import pipeline
        print(f"[DOMClassifier] Loading NLI model ({_NLI_MODEL}) — first use only…")
        _nli_pipeline = pipeline(
            "zero-shot-classification",
            model=_NLI_MODEL,
            device=-1,
        )
    return _nli_pipeline


def nli_classify_selector(selector: str) -> str:
    """Use NLI zero-shot for ambiguous selectors."""
    sequence = f"CSS selector: {selector}"
    pipe = _load_nli()
    result = pipe(sequence, candidate_labels=_NLI_ROLE_LABELS, multi_label=False)
    return _NLI_ROLE_MAP.get(result["labels"][0], "other")


# ── Public interface ──────────────────────────────────────────────────────────

class DOMClassifier:
    """
    Classify a CSS selector string into an element role.

    Args:
        use_nli: if True, fall back to NLI for ambiguous selectors.
    """

    def __init__(self, use_nli: bool = True):
        self.use_nli = use_nli

    def classify(self, selector: Optional[str]) -> str:
        """Returns element role string."""
        role = rule_classify_selector(selector)
        if role is None:
            role = nli_classify_selector(str(selector)) if self.use_nli else "other"
        return role

    def classify_batch(self, selectors: list) -> list:
        """Classify a list of selectors. Returns list of role strings."""
        results = []
        ambiguous = []
        ambiguous_idx = []

        for i, sel in enumerate(selectors):
            role = rule_classify_selector(sel)
            if role is not None:
                results.append(role)
            else:
                results.append(None)
                ambiguous.append(str(sel))
                ambiguous_idx.append(i)

        if ambiguous and self.use_nli:
            pipe = _load_nli()
            sequences = [f"CSS selector: {s}" for s in ambiguous]
            nli_results = pipe(sequences, candidate_labels=_NLI_ROLE_LABELS,
                               multi_label=False)
            if isinstance(nli_results, dict):
                nli_results = [nli_results]
            for i, res in enumerate(nli_results):
                role = _NLI_ROLE_MAP.get(res["labels"][0], "other")
                results[ambiguous_idx[i]] = role

        return results
