#!/usr/bin/env bash
# One-time, user-initiated pairing of this Codespace with ChatGPT Remote Desktop Commander.
# No credentials are printed, stored in this repository, or sent to the application.
set -euo pipefail
if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "Node.js and npx are required. Install them in this Codespace before continuing."
  exit 1
fi
echo "Starting the official Desktop Commander Remote pairing flow."
echo "Only approve if the pairing code displayed in the browser matches this terminal."
echo "Keep this terminal running while you want ChatGPT remote access."
exec npx --yes @wonderwhy-er/desktop-commander@latest remote
