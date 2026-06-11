"""Quality benchmark for screenshot pre-selection.

Hand-labeled test cases for the metadata heuristic in
api.v1.routes.annotate.heuristic_score (the first stage of select-screenshot;
the CLIP/MMR stage needs the model and is exercised separately).

Each case is a realistic UX issue plus candidate screenshots; `gold` is the
set of candidate indices a human reviewer labeled as correct. Some cases are
deliberately hard (no path keyword overlap, late-journey evidence) so the
score stays honest — the thresholds document the current quality level, and
a regression in the heuristic fails the suite.

Metrics:
  precision@1 — gold candidate ranked first
  MRR         — mean reciprocal rank of the best-ranked gold candidate
"""

from types import SimpleNamespace

import pytest

fastapi = pytest.importorskip("fastapi")

from api.v1.routes.annotate import dedup_indices_by_path, heuristic_score  # noqa: E402


def shot(path: str, trigger: str, action_id: str) -> SimpleNamespace:
    return SimpleNamespace(path=path, trigger=trigger, action_id=action_id)


# ─── Hand-labeled cases ───────────────────────────────────────────────────────
# gold = indices a human reviewer picked as the right screenshot for the issue.

CASES = [
    {
        "name": "search bar hard to find",
        "issue": "Users cannot find the search bar on the page",
        "shots": [shot("/home", "click", "0"), shot("/search", "input", "3"), shot("/about", "scroll", "9")],
        "gold": {1},  # the search page itself
    },
    {
        "name": "checkout button below fold",
        "issue": "The checkout button is hidden below the fold",
        "shots": [shot("/cart", "click", "1"), shot("/checkout", "click", "4"), shot("/", "navigate", "0")],
        "gold": {1},
    },
    {
        "name": "confusing nav labels",
        "issue": "Navigation menu labels are confusing",
        "shots": [shot("/", "navigate", "0"), shot("/products", "click", "2"), shot("/contact", "scroll", "6")],
        "gold": {0},  # homepage shows the nav menu
    },
    {
        "name": "pricing hard to locate",
        "issue": "Pricing information is hard to locate",
        "shots": [shot("/pricing", "navigate", "5"), shot("/home", "scroll", "1"), shot("/contact", "click", "3")],
        "gold": {0},
    },
    {
        "name": "unclear form error",
        "issue": "Error message after form submission is unclear",
        "shots": [shot("/contact", "input", "6"), shot("/contact", "click", "7"), shot("/thank-you", "navigate", "8")],
        "gold": {1, 2},  # the submit click or the result page both show the problem
    },
    {
        # HARD: no path keywords; evidence is a late-journey scrolled page.
        # The step-position prior pulls toward early screenshots.
        "name": "footer contrast (hard)",
        "issue": "Footer links have poor color contrast",
        "shots": [shot("/", "navigate", "0"), shot("/products", "click", "2"), shot("/sitemap", "scroll", "9")],
        "gold": {2},  # scrolled to the bottom — footer actually visible
    },
    {
        "name": "login rejects valid email",
        "issue": "Login form rejects valid email addresses",
        "shots": [shot("/login", "input", "2"), shot("/login", "click", "3"), shot("/", "navigate", "0")],
        "gold": {0, 1},
    },
    {
        "name": "product listing loads slowly",
        "issue": "Product images load slowly on the listing page",
        "shots": [shot("/products", "navigate", "1"), shot("/products/42", "click", "4"), shot("/cart", "click", "6")],
        "gold": {0},  # the listing page, not a detail page
    },
    {
        # HARD: the relevant filter interaction happens mid-journey on a page
        # whose path shares no words with the issue text.
        "name": "filters don't update (hard)",
        "issue": "Filter options do not update the result list",
        "shots": [shot("/products", "click", "5"), shot("/", "navigate", "0"), shot("/about", "scroll", "8")],
        "gold": {0},
    },
    {
        "name": "hamburger menu broken",
        "issue": "Mobile menu does not open when tapping the hamburger icon",
        "shots": [shot("/menu", "click", "1"), shot("/", "click", "0"), shot("/products", "scroll", "4")],
        "gold": {0},
    },
    {
        # HARD: "sign-up" (hyphenated) never matches the /signup path, and the
        # buried CTA is only visible on the scrolled homepage.
        "name": "buried signup CTA (hard)",
        "issue": "Sign-up call to action is buried at the bottom",
        "shots": [shot("/signup", "navigate", "3"), shot("/", "scroll", "1"), shot("/", "navigate", "0")],
        "gold": {0, 1},
    },
    {
        "name": "broken about link",
        "issue": "About page link returns a 404 error",
        "shots": [shot("/about", "click", "2"), shot("/", "navigate", "0"), shot("/contact", "click", "5")],
        "gold": {0},
    },
]

# Current quality level of the heuristic against the labels above.
# If a change drops below these, the selection got worse — investigate.
P_AT_1_THRESHOLD = 0.70
MRR_THRESHOLD = 0.80


def rank_shots(issue: str, shots: list[SimpleNamespace]) -> list[int]:
    """Indices sorted best-first by the production heuristic."""
    words = {w for w in issue.lower().split() if len(w) > 3}
    scores = [heuristic_score(s, words) for s in shots]
    return sorted(range(len(shots)), key=lambda i: scores[i], reverse=True)


def evaluate() -> tuple[float, float, list[str]]:
    hits_at_1 = 0
    reciprocal_ranks: list[float] = []
    report: list[str] = []
    for case in CASES:
        ranking = rank_shots(case["issue"], case["shots"])
        gold_rank = min(ranking.index(g) for g in case["gold"]) + 1  # 1-based
        hit = gold_rank == 1
        hits_at_1 += hit
        reciprocal_ranks.append(1.0 / gold_rank)
        report.append(f"  {'✓' if hit else '✗'} {case['name']:<32} gold at rank {gold_rank}")
    p_at_1 = hits_at_1 / len(CASES)
    mrr = sum(reciprocal_ranks) / len(reciprocal_ranks)
    return p_at_1, mrr, report


class TestSelectionQuality:
    def test_quality_score(self):
        p_at_1, mrr, report = evaluate()
        summary = (
            f"\nScreenshot-selection quality ({len(CASES)} hand-labeled cases)\n"
            + "\n".join(report)
            + f"\n  precision@1 = {p_at_1:.2f} (threshold {P_AT_1_THRESHOLD})"
            + f"\n  MRR         = {mrr:.2f} (threshold {MRR_THRESHOLD})"
        )
        print(summary)
        assert p_at_1 >= P_AT_1_THRESHOLD, summary
        assert mrr >= MRR_THRESHOLD, summary

    def test_every_case_in_top_3(self):
        # Top-3 is what effectively reaches the LLM judge after MMR trimming —
        # a gold candidate falling out of the top 3 is a hard failure.
        for case in CASES:
            ranking = rank_shots(case["issue"], case["shots"])
            gold_rank = min(ranking.index(g) for g in case["gold"]) + 1
            assert gold_rank <= 3, f"{case['name']}: gold at rank {gold_rank}"


class TestDedupByPath:
    def test_keeps_first_and_last_per_path(self):
        paths = ["/a", "/a", "/a", "/b"]
        assert dedup_indices_by_path(paths) == [0, 2, 3]

    def test_single_occurrence_kept_once(self):
        assert dedup_indices_by_path(["/a", "/b"]) == [0, 1]

    def test_none_paths_grouped_together(self):
        assert dedup_indices_by_path([None, None, None]) == [0, 2]

    def test_preserves_original_order(self):
        paths = ["/b", "/a", "/b", "/a", "/c"]
        assert dedup_indices_by_path(paths) == [0, 1, 2, 3, 4]
