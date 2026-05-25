"""pytest tests for PolicyExtractor — runs without a DB connection."""
import sys
import os

# Allow importing the policy package directly from the microservice src tree
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from policy.policy_extractor import PolicyExtractor

SAMPLE_EVENTS = [
    {
        "id": 1,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "pageview",
        "timestamp": 1778069269177,
        "path": "/",
        "data": {"title": "", "url": "http://localhost:8080/"},
    },
    {
        "id": 3,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "mousemove",
        "timestamp": 1778069269464,
        "path": "/",
        "data": {"x": 984, "y": 525, "pageX": 984, "pageY": 525},
    },
    {
        "id": 35,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "hover_intent",
        "timestamp": 1778069275832,
        "path": "/",
        "data": {
            "selector": "li > a",
            "tag": "a",
            "text": "Klassenvorstände",
            "href": "http://localhost:8080/file.pdf",
        },
    },
    {
        "id": 45,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "click",
        "timestamp": 1778069276973,
        "path": "/",
        "data": {
            "x": 941,
            "y": 321,
            "selector": "li.menu-item > a",
            "tag": "a",
            "text": "Reifeprüfung und ABA",
            "href": "http://localhost:8080/?page_id=8168",
            "element_w": 200,
            "element_h": 38,
            "action_id": "a_c55z43hjep9",
        },
    },
    {
        "id": 46,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "page_leave",
        "timestamp": 1778069277010,
        "path": "/",
        "data": {"scroll_depth": 0, "time_on_page": 8874},
    },
    {
        "id": 47,
        "session_id": "s_abc",
        "site_id": "site1",
        "type": "pageview",
        "timestamp": 1778069277259,
        "path": "/?page_id=8168",
        "data": {
            "title": "Reifeprüfung und ABA",
            "url": "http://localhost:8080/?page_id=8168",
        },
    },
]


def test_extract_steps_splits_on_pageview():
    extractor = PolicyExtractor()
    steps = extractor.extract_steps(SAMPLE_EVENTS)
    assert len(steps) == 2, f"Expected 2 steps, got {len(steps)}"
    assert steps[0]["path"] == "/"
    assert steps[1]["path"] == "/?page_id=8168"


def test_extract_decision_detects_click():
    extractor = PolicyExtractor()
    steps = extractor.extract_steps(SAMPLE_EVENTS)
    decision = extractor.extract_decision(steps[0])

    assert decision["action"]["type"] == "click"
    assert decision["action"]["text"] == "Reifeprüfung und ABA"
    assert "page_id=8168" in decision["action"]["href"]
    assert decision["action"]["position"]["x"] == 941
    assert decision["action"]["position"]["y"] == 321


def test_extract_decision_hover_captured():
    extractor = PolicyExtractor()
    steps = extractor.extract_steps(SAMPLE_EVENTS)
    decision = extractor.extract_decision(steps[0])

    hover_texts = [h["text"] for h in decision["hover_targets"]]
    assert "Klassenvorstände" in hover_texts


def test_extract_decision_bounce_when_no_click():
    extractor = PolicyExtractor()
    # Build a step with no click events
    no_click_step = {
        "path": "/no-click",
        "pageview_data": {"title": "Empty"},
        "events": [],
        "leave_data": {"scroll_depth": 15, "time_on_page": 3000},
        "clicks": [],
        "hovers": [],
        "errors": [],
        "perf_data": {},
    }
    decision = extractor.extract_decision(no_click_step)
    assert decision["action"]["type"] == "bounce"
    assert decision["scroll_depth"] == 15
    assert decision["time_on_page_ms"] == 3000


def test_extract_decision_page_leave_data():
    extractor = PolicyExtractor()
    steps = extractor.extract_steps(SAMPLE_EVENTS)
    decision = extractor.extract_decision(steps[0])

    assert decision["time_on_page_ms"] == 8874
    assert decision["scroll_depth"] == 0
    assert decision["js_errors_count"] == 0


def test_generate_prompt_injection_format():
    extractor = PolicyExtractor()
    steps = extractor.extract_steps(SAMPLE_EVENTS)

    # Build a minimal policy from the sample
    decisions = [extractor.extract_decision(steps[0])]
    policy = {"/": extractor._aggregate(decisions)}

    injection = extractor.generate_prompt_injection("/", policy)

    assert "<human_behavioral_policy>" in injection
    assert "</human_behavioral_policy>" in injection
    assert "Reifeprüfung und ABA" in injection
    assert "PREFERRED ACTIONS" in injection
    assert "BEHAVIORAL CONTEXT" in injection


def test_generate_prompt_injection_no_data():
    extractor = PolicyExtractor()
    injection = extractor.generate_prompt_injection("/unknown-path", {})

    assert "<human_behavioral_policy>" in injection
    assert "No human data available" in injection


def test_get_policy_for_page_exact_match():
    extractor = PolicyExtractor()
    policy = {"/": {"n_sessions": 5, "action_distribution": []}}
    result = extractor.get_policy_for_page("/", policy)
    assert result is not None
    assert result["_match_type"] == "exact"


def test_get_policy_for_page_normalized_match():
    extractor = PolicyExtractor()
    # Policy has path without trailing slash
    policy = {"/about": {"n_sessions": 3, "action_distribution": []}}
    result = extractor.get_policy_for_page("/about/", policy)
    assert result is not None
    assert result["_match_type"] == "normalized"


def test_get_policy_for_page_query_param_strip():
    extractor = PolicyExtractor()
    policy = {"/": {"n_sessions": 10, "action_distribution": []}}
    # Query param path should fall back to base path
    result = extractor.get_policy_for_page("/?ref=newsletter", policy)
    assert result is not None
    assert result["_match_type"] == "normalized"


def test_get_policy_for_page_no_match():
    extractor = PolicyExtractor()
    policy = {"/about": {"n_sessions": 3, "action_distribution": []}}
    result = extractor.get_policy_for_page("/contact", policy)
    assert result is None
