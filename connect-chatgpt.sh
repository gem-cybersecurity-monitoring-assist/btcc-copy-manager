#!/usr/bin/env bash
# Run the pinned remote agent; authentication stays in its private user configuration.
set -euo pipefail
command -v node >/dev/null && command -v npx >/dev/null || {
  echo "Node.js and npx are required in this Codespace." >&2
  exit 1
}
# Reuse the already downloaded version, avoiding a registry lookup on every resume.
cached_entry="$(python3 - <<'PY'
import glob, json, os
from pathlib import Path
for name in glob.glob(os.path.expanduser('~/.npm/_npx/*/node_modules/@wonderwhy-er/desktop-commander/package.json')):
    p = Path(name)
    try:
        if json.loads(p.read_text()).get('version') == '0.3.1':
            entry = p.parent / 'dist/index.js'
            if entry.is_file():
                print(entry)
                break
    except (OSError, ValueError):
        pass
PY
)"
if [[ -n "$cached_entry" ]]; then
  exec node "$cached_entry" remote "$@"
fi
exec npx --yes --package=@wonderwhy-er/desktop-commander@0.3.1 desktop-commander remote "$@"
