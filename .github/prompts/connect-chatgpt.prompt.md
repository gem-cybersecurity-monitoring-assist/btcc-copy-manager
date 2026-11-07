---
description: "Connect this existing GitHub Codespace to ChatGPT through Desktop Commander Remote"
agent: "agent"
---

You are working inside the existing GitHub Codespace for `gem-cybersecurity-monitoring-assist/btcc-copy-manager`. Complete this task in the **Codespace's integrated terminal**. Do not ask the owner to copy or paste terminal commands.

Objective: start the authenticated Desktop Commander Remote process using the repository's `connect-chatgpt.sh` script, so the owner can authorize ChatGPT to operate this Codespace as a remote shell without using their PC.

1. Verify the terminal working directory is this repository (`pwd`, `git remote -v`, `git status --short`). Inspect any modified files and preserve all user changes; do not reset or force-pull.
2. Retrieve the current `main` branch updates safely. If the working tree is clean and on `main`, use `git pull --ff-only`. Otherwise use `git fetch origin main` and locate the script from origin/main without overriding existing changes. If the script is already present locally, use it as-is after inspection. Never wipe a workspace.
3. Read `connect-chatgpt.sh` to verify what it will execute. Check `node --version` and `npx --version`. Do not display secrets or tokens.
4. From the repository root, launch `bash connect-chatgpt.sh` in a persistent integrated-terminal session. If `npx` asks about installing the published Desktop Commander package, follow normal package-manager safety prompts. Do not alter application trading configuration.
5. Keep the process running. Surface the pairing URL/code to the owner in the Codespace chat or terminal, without sending it to external destinations. **The owner must personally verify and approve pairing.** Do not pretend to complete authentication.
6. After approval, report the terminal process status and whether the Codespace appears connected. If the agent exits, report its actual error output and the minimal safe correction; do not claim the connection works without verification.

Safety: no live trading, no reading or uploading exchange credentials, no transfers, withdrawals, deployment-secret retrieval, or changing network exposure/security settings. Do not expose terminal ports publicly. Do not run unreviewed code beyond the intended remote-agent setup. If the user is only able to interact via phone, do all shell typing yourself from Copilot agent mode and request a tap/approval only when unavoidable.
