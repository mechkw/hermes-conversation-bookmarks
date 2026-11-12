#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
# Catalog probes spawn children: sys.path edits in parent Python do not propagate.
HERMES_SOURCE="$(cd "${HERMES_SOURCE:-$HOME/.hermes/hermes-agent}" && pwd)"
export HERMES_SOURCE
export PYTHONPATH="$HERMES_SOURCE${PYTHONPATH:+:$PYTHONPATH}"
: "${TMPDIR:=$HOME/.hermes/cache/scratch}"
export TMPDIR
mkdir -p "$TMPDIR"
"${PYTHON:-python}" -m unittest discover -s tests -p 'test_*.py' -v
"${PYTHON:-python}" tests/native_probe.py
"${PYTHON:-python}" tests/native_contract.py
"${PYTHON:-python}" tests/native_telegram.py
"${PYTHON:-python}" tests/native_command_discovery.py
npm run build
npm run test:contract
# The host's own admission lint for desktop plugins: no forbidden constructs, no review cues.
"${PYTHON:-python}" - <<'PY'
from pathlib import Path
from hermes_cli import plugin_validate_desktop as lint
source = Path('desktop/plugin.js').read_text()
problems = lint.desktop_surface_hits(Path('.')) + lint.desktop_surface_findings(source) + lint.desktop_review_findings(source)
if problems:
    raise SystemExit(f'Desktop surface lint: {problems}')
print('PASS host desktop-surface lint')
PY
npm run test:browser
