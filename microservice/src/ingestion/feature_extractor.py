"""
Maps raw click events to abstract step tuples.

Two modes:
  adobe   — rule-based (for pretraining on Adobe parquet data)
  generic — uses site_schema.json + URLClassifier + DOMClassifier

Abstract step format (dict):
    {
        "page_type":    str,   # from PAGE_TYPES
        "page_depth":   int,   # 0–5
        "element_role": str,   # from ELEMENT_ROLES
        "dest_type":    str,   # from DEST_TYPES
    }
"""
import json
from typing import Optional, Dict
from urllib.parse import urlparse


def _dest_type(src_url: str, tgt_url: Optional[str]) -> str:
    """Classify the navigation relationship between source and target URL."""
    if not tgt_url:
        return "no_nav"
    try:
        src_domain = urlparse(src_url).netloc
        tgt_domain = urlparse(tgt_url).netloc
        src_depth  = len(urlparse(src_url).path.strip("/").split("/"))
        tgt_depth  = len(urlparse(tgt_url).path.strip("/").split("/"))
    except Exception:
        return "unknown"

    if src_domain and tgt_domain and src_domain != tgt_domain:
        return "external_exit"

    if tgt_depth > src_depth:
        return "drill_down"
    elif tgt_depth < src_depth:
        return "back_nav"
    else:
        return "lateral_nav"


# ── Adobe rule-based abstractor ───────────────────────────────────────────────

from ingestion.url_classifier import URLClassifier as _URLCls
from ingestion.dom_classifier import DOMClassifier as _DOMCls

# For Adobe pretraining we use rules-only (no NLI) for speed
_adobe_url_cls = None
_adobe_dom_cls = None


def _get_adobe_classifiers():
    global _adobe_url_cls, _adobe_dom_cls
    if _adobe_url_cls is None:
        _adobe_url_cls = _URLCls(use_nli=False)
        _adobe_dom_cls = _DOMCls(use_nli=False)
    return _adobe_url_cls, _adobe_dom_cls


def abstract_adobe_row(page_url: str,
                        click_source: Optional[str],
                        click_target_url: Optional[str]) -> Dict:
    """
    Convert one Adobe parquet row into an abstract step dict.
    Fast rule-based — no model inference.
    """
    url_cls, dom_cls = _get_adobe_classifiers()

    page_info = url_cls.classify(page_url)
    role = dom_cls.classify(click_source)
    dest = _dest_type(page_url, click_target_url)

    return {
        "page_type":    page_info["page_type"],
        "page_depth":   page_info["page_depth"],
        "element_role": role,
        "dest_type":    dest,
    }


# ── Generic feature extractor (uses site_schema.json) ─────────────────────────

class FeatureExtractor:
    """
    Extracts abstract step features for a new (non-Adobe) site.

    The site_schema.json maps:
        URL pattern or exact path → {"page_type": ..., "page_depth": ...}
        CSS selector pattern      → {"element_role": ...}

    Falls back to URLClassifier + DOMClassifier for unknown entries.

    Args:
        schema_path: path to site_schema.json (optional; falls back to classifiers)
        use_nli:     whether to use NLI for unrecognized URLs/selectors
    """

    def __init__(self, schema_path: Optional[str] = None, use_nli: bool = True):
        self.url_cls = _URLCls(use_nli=use_nli)
        self.dom_cls = _DOMCls(use_nli=use_nli)
        self.url_schema: Dict[str, Dict] = {}
        self.sel_schema: Dict[str, str]  = {}

        if schema_path:
            self._load_schema(schema_path)

    def _load_schema(self, path: str):
        with open(path) as f:
            schema = json.load(f)
        for entry in schema.get("pages", []):
            self.url_schema[entry["pattern"]] = {
                "page_type":  entry.get("page_type", "other"),
                "page_depth": entry.get("page_depth", 0),
            }
        for entry in schema.get("elements", []):
            self.sel_schema[entry["selector"]] = entry.get("element_role", "other")

    def _lookup_url(self, url: str) -> Dict:
        """Try schema first, then classifier."""
        try:
            path = urlparse(url).path
        except Exception:
            path = url
        # Exact match
        if path in self.url_schema:
            return self.url_schema[path]
        # Prefix match
        for pattern, info in self.url_schema.items():
            if path.startswith(pattern.rstrip("*")):
                return info
        # Fall back to classifier
        return self.url_cls.classify(url)

    def _lookup_selector(self, selector: Optional[str]) -> str:
        """Try schema first, then classifier."""
        if not selector:
            return "unknown"
        if selector in self.sel_schema:
            return self.sel_schema[selector]
        return self.dom_cls.classify(selector)

    def extract(self, page_url: str,
                click_source: Optional[str],
                click_target_url: Optional[str]) -> Dict:
        """Convert one raw click event to an abstract step dict."""
        page_info = self._lookup_url(page_url)
        role = self._lookup_selector(click_source)
        dest = _dest_type(page_url, click_target_url)

        return {
            "page_type":    page_info["page_type"],
            "page_depth":   page_info["page_depth"],
            "element_role": role,
            "dest_type":    dest,
        }
