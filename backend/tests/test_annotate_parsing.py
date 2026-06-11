"""Unit tests for the pure parsing helpers in api.v1.routes.annotate."""

import pytest

fastapi = pytest.importorskip("fastapi")

from api.v1.routes.annotate import (  # noqa: E402
    detect_media_type,
    parse_annotation_points,
    parse_selection_index,
    png_dimensions,
    strip_code_fences,
)


class TestStripCodeFences:
    def test_plain_json_passthrough(self):
        assert strip_code_fences('{"a": 1}') == '{"a": 1}'

    def test_fenced_json(self):
        assert strip_code_fences('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_fenced_without_language(self):
        assert strip_code_fences('```\n{"a": 1}\n```') == '{"a": 1}'


class TestParseAnnotationPoints:
    def test_valid_points(self):
        raw = '{"found": true, "points": [{"x": 72, "y": 18, "glyph": "warning", "label": "CTA"}]}'
        pts = parse_annotation_points(raw, 1920, 1080)
        assert len(pts) == 1
        assert pts[0].x == 72 and pts[0].y == 18
        assert pts[0].glyph == "warning"

    def test_pixel_coords_normalised_to_percent(self):
        raw = '{"points": [{"x": 960, "y": 540, "label": "centre"}]}'
        pts = parse_annotation_points(raw, 1920, 1080)
        assert pts[0].x == 50.0 and pts[0].y == 50.0

    def test_coords_clamped_to_0_100(self):
        raw = '{"points": [{"x": -5, "y": 50, "label": "edge"}]}'
        pts = parse_annotation_points(raw, 1920, 1080)
        assert pts[0].x == 0.0

    def test_unknown_glyph_falls_back_to_warning(self):
        raw = '{"points": [{"x": 10, "y": 10, "glyph": "explosion", "label": "?"}]}'
        assert parse_annotation_points(raw, 1920, 1080)[0].glyph == "warning"

    def test_garbage_returns_empty(self):
        assert parse_annotation_points("not json at all", 1920, 1080) == []

    def test_missing_points_key_returns_empty(self):
        assert parse_annotation_points('{"found": true}', 1920, 1080) == []

    def test_invalid_point_skipped_valid_kept(self):
        raw = '{"points": [{"label": "no coords"}, {"x": 5, "y": 5, "label": "ok"}]}'
        pts = parse_annotation_points(raw, 1920, 1080)
        assert len(pts) == 1 and pts[0].label == "ok"

    def test_markdown_fenced_response(self):
        raw = '```json\n{"points": [{"x": 30, "y": 40, "label": "fenced"}]}\n```'
        assert len(parse_annotation_points(raw, 1920, 1080)) == 1


class TestParseSelectionIndex:
    def test_valid_index(self):
        assert parse_selection_index('{"index": 2}', 5) == 2

    def test_explicit_null_means_no_match(self):
        assert parse_selection_index('{"index": null}', 5) is None

    def test_out_of_range_is_invalid(self):
        assert parse_selection_index('{"index": 9}', 5) == "invalid"

    def test_negative_is_invalid(self):
        assert parse_selection_index('{"index": -1}', 5) == "invalid"

    def test_garbage_is_invalid(self):
        assert parse_selection_index("pick the third one", 5) == "invalid"

    def test_fenced_response(self):
        assert parse_selection_index('```json\n{"index": 0}\n```', 5) == 0


class TestDetectMediaType:
    def test_png(self):
        assert detect_media_type(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16) == "image/png"

    def test_jpeg(self):
        assert detect_media_type(b"\xff\xd8\xff\xe0" + b"\x00" * 16) == "image/jpeg"

    def test_webp(self):
        assert detect_media_type(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 8) == "image/webp"

    def test_unknown_defaults_to_png(self):
        assert detect_media_type(b"GIF89a" + b"\x00" * 16) == "image/png"


class TestPngDimensions:
    def test_reads_ihdr_dimensions(self):
        # Minimal PNG header: signature + IHDR length/type + width=640, height=480
        raw = (
            b"\x89PNG\r\n\x1a\n"
            + b"\x00\x00\x00\x0dIHDR"
            + (640).to_bytes(4, "big")
            + (480).to_bytes(4, "big")
        )
        assert png_dimensions(raw) == (640, 480)

    def test_non_png_returns_default(self):
        assert png_dimensions(b"\xff\xd8\xff\xe0" + b"\x00" * 24) == (1920, 1080)

    def test_truncated_png_returns_default(self):
        assert png_dimensions(b"\x89PNG") == (1920, 1080)
