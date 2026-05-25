#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CipherCorgi microservice – environment setup
# Run once after cloning, or after updating requirements.txt.
#
# Usage (from project root):
#   bash microservice/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONDA_ENV="xaiml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Creating conda env '$CONDA_ENV' (Python 3.12) …"
conda create -n "$CONDA_ENV" python=3.12 -y

echo "==> Installing uv …"
conda run -n "$CONDA_ENV" pip install --upgrade pip uv

echo "==> Installing Unsloth (auto-detects CUDA + torch version) …"
conda run -n "$CONDA_ENV" uv pip install unsloth --torch-backend=auto

echo "==> Installing remaining dependencies …"
conda run -n "$CONDA_ENV" pip install -r "$SCRIPT_DIR/requirements.txt"

echo "==> Installing Playwright browsers …"
conda run -n "$CONDA_ENV" playwright install firefox || true
if conda run -n "$CONDA_ENV" playwright install chromium 2>/dev/null; then
    conda run -n "$CONDA_ENV" playwright install-deps chromium || true
else
    echo "    Playwright bundled Chromium not supported on this OS — falling back to system Chromium."
    if ! command -v chromium &>/dev/null && ! command -v chromium-browser &>/dev/null; then
        echo "    Installing system Chromium …"
        sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
    fi
    CHROMIUM_PATH=$(command -v chromium || command -v chromium-browser)
    echo "    Using system Chromium at: $CHROMIUM_PATH"
    echo "    Export this before running: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$CHROMIUM_PATH"
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$CHROMIUM_PATH"
fi

echo "==> Creating pipeline data directories …"
mkdir -p "$SCRIPT_DIR/../pipeline_data/"{screenshots,doms,trajectories,adapters,human_trajectories}

echo ""
echo "==> Setup complete."
echo ""
echo "    Next steps:"
echo "    1. Run Phase 1 (hydrate Adobe data):"
echo "       conda run -n $CONDA_ENV python microservice/src/scripts/hydrate.py \\"
echo "           --parquet research/data/adobe.parquet"
echo ""
echo "    2. Run Phase 2 (train VLM):"
echo "       conda run -n $CONDA_ENV torchrun --nproc_per_node=1 \\"
echo "           microservice/src/scripts/train_vlm.py \\"
echo "           --train-jsonl pipeline_data/trajectories/hydrated.jsonl \\"
echo "           --output-dir pipeline_data/adapters/v1"
echo ""
echo "    3. Run Phase 3 (evaluate a site):"
echo "       conda run -n $CONDA_ENV python microservice/src/scripts/run_evaluator.py \\"
echo "           --adapter pipeline_data/adapters/current \\"
echo "           --goal 'Find pricing' --url 'https://www.adobe.com'"
echo ""
echo "    4. Nightly update (run via cron):"
echo "       conda run -n $CONDA_ENV python microservice/src/scripts/nightly_update.py \\"
echo "           --base-trajectory pipeline_data/trajectories/hydrated.jsonl"
