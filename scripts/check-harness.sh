#!/usr/bin/env sh
set -eu
python -m compileall -q harness harness.py tests/harness
if command -v ruff >/dev/null 2>&1; then ruff check harness harness.py tests/harness; else echo "SKIP  ruff not installed"; fi
if python -c 'import mypy' >/dev/null 2>&1; then python -m mypy harness; else echo "SKIP  mypy not installed"; fi
python harness.py validate
python -m pytest -q tests/harness
