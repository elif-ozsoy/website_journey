"""
Automatic site_schema.json builder.

Given a list of URLs (from a sitemap) and optionally CSS selectors
observed in click data, produces a site_schema.json without VLMs or
manual annotation.

Output format (site_schema.json):
{
  "site": "https://acme.com",
  "pages": [
    {"pattern": "/pricing", "page_type": "pricing", "page_depth": 1},
    {"pattern": "/blog/",   "page_type": "blog_post", "page_depth": 2},
    ...
  ],
  "elements": [
    {"selector": ".cta-primary",  "element_role": "cta"},
    {"selector": ".nav__link",    "element_role": "nav_link"},
    ...
  ]
}
"""
import json
import re
from typing import List, Optional
from urllib.parse import urlparse
from collections import Counter

from ingestion.url_classifier import URLClassifier, depth_from_url
from ingestion.dom_classifier import DOMClassifier


def _deduplicate_url_patterns(urls: List[str]) -> List[str]:
    """
    Reduce a large URL list to representative patterns.
    Groups URLs by their first 2 path segments, keeps one per group.
    This avoids passing thousands of near-identical product URLs to the classifier.
    """
    seen = set()
    deduped = []
    for url in urls:
        try:
            parts = urlparse(url).path.strip("/").split("/")[:2]
            key = "/".join(parts)
        except Exception:
            key = url
        if key not in seen:
            seen.add(key)
            deduped.append(url)
    return deduped


class SiteSchemaBuilder:
    """
    Build site_schema.json from a list of observed URLs and CSS selectors.

    Args:
        use_nli: whether to use NLI for ambiguous classification (recommended True)
    """

    def __init__(self, use_nli: bool = True):
        self.url_classifier = URLClassifier(use_nli=use_nli)
        self.dom_classifier = DOMClassifier(use_nli=use_nli)

    def build(
        self,
        site_url: str,
        page_urls: List[str],
        selectors: Optional[List[str]] = None,
        output_path: Optional[str] = None,
        verbose: bool = True,
    ) -> dict:
        """
        Classify all provided URLs and selectors.

        Args:
            site_url:    Base URL of the site (e.g. "https://acme.com")
            page_urls:   List of page URLs observed in click data or sitemap
            selectors:   List of CSS selectors observed in click data (optional)
            output_path: If provided, save schema to this JSON file
            verbose:     Print progress

        Returns:
            schema dict (same structure as site_schema.json)
        """
        # ── Classify pages ────────────────────────────────────────────────────
        # Deduplicate to avoid redundant classification
        unique_urls = _deduplicate_url_patterns(list(set(page_urls)))
        if verbose:
            print(f"[SchemaBuilder] Classifying {len(unique_urls)} unique URL patterns…")

        url_results = self.url_classifier.classify_batch(unique_urls)
        pages = []
        for url, result in zip(unique_urls, url_results):
            try:
                path = urlparse(url).path or "/"
            except Exception:
                path = url
            pages.append({
                "pattern":    path,
                "page_type":  result["page_type"],
                "page_depth": result["page_depth"],
            })

        # Sort by specificity (longer paths first — more specific matches win)
        pages.sort(key=lambda x: -len(x["pattern"]))

        # ── Classify selectors ────────────────────────────────────────────────
        elements = []
        if selectors:
            # Deduplicate and filter null
            unique_sels = list({s for s in selectors if s and str(s).strip()})
            if verbose:
                print(f"[SchemaBuilder] Classifying {len(unique_sels)} unique selectors…")
            roles = self.dom_classifier.classify_batch(unique_sels)
            for sel, role in zip(unique_sels, roles):
                elements.append({"selector": str(sel), "element_role": role})

        schema = {
            "site":     site_url,
            "pages":    pages,
            "elements": elements,
        }

        if output_path:
            with open(output_path, "w") as f:
                json.dump(schema, f, indent=2)
            if verbose:
                print(f"[SchemaBuilder] Saved schema to {output_path}")

        return schema

    @staticmethod
    def from_parquet(parquet_paths: List[str],
                     site_url: str,
                     output_path: Optional[str] = None,
                     use_nli: bool = True,
                     verbose: bool = True) -> dict:
        """
        Convenience method: build schema directly from parquet click data files.
        Extracts unique page_urls and click_sources automatically.
        """
        import pandas as pd

        all_pages = []
        all_selectors = []
        for path in parquet_paths:
            df = pd.read_parquet(path, columns=["page_url", "click_source",
                                                 "click_target_url"])
            all_pages.extend(df["page_url"].dropna().unique().tolist())
            all_pages.extend(df["click_target_url"].dropna().unique().tolist())
            all_selectors.extend(df["click_source"].dropna().unique().tolist())

        builder = SiteSchemaBuilder(use_nli=use_nli)
        return builder.build(site_url, all_pages, all_selectors,
                             output_path=output_path, verbose=verbose)
