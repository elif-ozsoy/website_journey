"""Unit tests for the pure helpers in services.clip_service.

torch-dependent tests are skipped automatically when torch is not installed
(e.g. on a dev host without the backend container's dependencies).
"""

import pytest

torch = pytest.importorskip("torch")

from services.clip_service import _to_normed_feat, _visual_content_score  # noqa: E402


class TestToNormedFeat:
    def test_plain_tensor_is_unit_normalised(self):
        feat = torch.tensor([[3.0, 4.0]])
        out = _to_normed_feat(feat, torch)
        assert torch.allclose(out.norm(dim=-1), torch.tensor([1.0]))

    def test_zero_vector_produces_no_nan(self):
        feat = torch.tensor([[0.0, 0.0], [3.0, 4.0]])
        out = _to_normed_feat(feat, torch)
        assert not torch.isnan(out).any()
        assert torch.allclose(out[1].norm(), torch.tensor(1.0))

    def test_model_output_with_pooler_output(self):
        class FakeOutput:
            pooler_output = torch.tensor([[1.0, 0.0]])

            def __getitem__(self, i):
                raise AssertionError("should use pooler_output, not indexing")

        out = _to_normed_feat(FakeOutput(), torch)
        assert torch.allclose(out, torch.tensor([[1.0, 0.0]]))

    def test_model_output_without_pooler_falls_back_to_first_field(self):
        class FakeOutput:
            def __getitem__(self, i):
                assert i == 0
                return torch.tensor([[0.0, 2.0]])

        out = _to_normed_feat(FakeOutput(), torch)
        assert torch.allclose(out, torch.tensor([[0.0, 1.0]]))


class TestVisualContentScore:
    def test_blank_image_scores_zero(self):
        PIL = pytest.importorskip("PIL")
        img = PIL.Image.new("RGB", (32, 32), color=(128, 128, 128))
        assert _visual_content_score(img) == 0.0

    def test_high_contrast_image_scores_one(self):
        PIL = pytest.importorskip("PIL")
        img = PIL.Image.new("RGB", (32, 32))
        px = img.load()
        for x in range(32):
            for y in range(32):
                px[x, y] = (255, 255, 255) if (x + y) % 2 == 0 else (0, 0, 0)
        assert _visual_content_score(img) == 1.0
