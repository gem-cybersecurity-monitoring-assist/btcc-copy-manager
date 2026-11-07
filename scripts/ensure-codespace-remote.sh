#!/usr/bin/env bash
# Resume the existing authenticated device without opening a terminal or public port.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/gem-copy-center-remote"
umask 077
mkdir -p "$STATE"
chmod 700 "$STATE"
exec 9>"$STATE/start.lock"
flock -n 9 || { echo "Remote startup is already being checked."; exit 0; }

# Inspect process metadata only. Never read the saved authentication file.
existing="$(python3 - <<'PY'
from pathlib import Path
for p in Path('/proc').iterdir():
    if not p.name.isdigit():
        continue
    try:
        args = (p / 'cmdline').read_bytes().split(b'\0')
        if len(args) > 2 and b'node' in args[0] and b'desktop-commander' in args[1] and b'remote' in args[2:]:
            print(p.name)
            break
    except OSError:
        pass
PY
)"
if [[ -n "$existing" ]]; then
  echo "Remote device process is running (PID $existing)."
  exit 0
fi
if [[ "${1:-}" == "--status" ]]; then
  echo "Remote device process is not running."
  exit 1
fi
if [[ ! -f "$HOME/.desktop-commander-device/device.json" ]]; then
  echo "Owner pairing is required. Run bash connect-chatgpt.sh once and approve the device."
  exit 2
fi
cd "$ROOT"
nohup bash "$ROOT/connect-chatgpt.sh" </dev/null >>"$STATE/agent.log" 2>&1 9>&- &
remote_pid=$!
echo "$remote_pid" >"$STATE/launcher.pid"
echo "Started saved-session remote agent (launcher PID $remote_pid). Verify Online in Desktop Commander."
