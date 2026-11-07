# GEM Copy Center — ChatGPT Workspace Handoff

**Verified:** 2026-11-07 (UTC). **Owner workspace:** GitHub organization `gem-cybersecurity-monitoring-assist`. This is a project handoff, not evidence that an external ChatGPT Work session has been opened or updated.

## Primary links
- Private source repository: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager
- Existing Codespace editor: https://orange-waddle-q7g66xg5p5j5f5q7.github.dev/
- Production dashboard: https://btcc-copy-manager.vercel.app/copy-center
- Paper positions and approval queue: https://btcc-copy-manager.vercel.app/copy-center/positions
- Copy-trading research/trader workspace: https://btcc-copy-manager.vercel.app/copy-trading
- Pairing script: `connect-chatgpt.sh`
- Copilot agent prompt: `.github/prompts/connect-chatgpt.prompt.md`

## Completed and verified
1. Connected GitHub access to the **private** `btcc-copy-manager` repository (read/write).
2. Preserved the existing Next.js Copy Center dashboard with provider guides/connections, mobile layout, risk controls, cloud authentication and workspace APIs, and the separate copy-trading research workspace. Some capabilities have not been owner-tested.
3. Added `/copy-center/positions` (PR #44, merged): **paper-only** position records with venue/trader/symbol/side/notional/entry/mark, illustrative P&L, configurable paper-entry cap and planned-loss percentage, request/approve/reject flow for simulated closures. Positions and approvals are stored only in the current browser's localStorage, not synced to the cloud. No exchange execution is wired into this new route.
4. Extended `scripts/smoke-production.mjs` to cover `/copy-center/positions` (PR #45, merged). The PR's CI and production smoke checks passed.
5. Explicit Vercel production deployment `dpl_62D78Hc9hHeN3tWHBFUCHJ98tpws`, commit `5e9ab410ceeb24cc1998e3fbdb4babe35c51d312`, reported **READY** and assigned `btcc-copy-manager.vercel.app`. Later main-branch commits for Codespace pairing documentation passed GitHub Actions; no claim that those documentation commits were redeployed.
6. Added `connect-chatgpt.sh` (commit `deb7461b7`) to invoke `npx --yes @wonderwhy-er/desktop-commander@latest remote` in a user-controlled Codespace terminal.
7. Added Copilot agent prompt `.github/prompts/connect-chatgpt.prompt.md` (commit `9657b99c2`) so Copilot Agent can run the connection sequence without the owner pasting terminal commands. Both CI and smoke checks on that commit passed.

## Important current access boundary
- The Codespace URL was supplied by the owner, but no terminal access has been established from this ChatGPT session.
- Desktop Commander currently lists **only GEM-ASSIST, offline**, last seen approximately 60 hours before inspection.
- The user has difficulty pasting into the Codespace terminal on an iPhone. Use the Copilot Agent prompt above, with Copilot executing shell commands and the owner only verifying/approving pairing. **Do not say the pairing succeeded until the new remote device is online in Desktop Commander and a harmless command has been executed there.**
- GitHub repository access and Vercel API access do not confer a Codespace shell, nor permit bypassing pairing.

## Remaining acceptance work, prioritized
1. **Codespace access:** In the existing Codespace, have Copilot Agent follow `.github/prompts/connect-chatgpt.prompt.md`. Preserve any uncommitted files; safely fetch main before running `bash connect-chatgpt.sh`. Owner must approve pairing and verify code. Check the connected device and then run harmless shell checks (`pwd`, `git status`, `node -v`).
2. **iPhone owner authentication:** Open the real production dashboard, sign in, verify email/session persistence, verify logout and authorization on protected endpoints. Do not fabricate completion from build logs.
3. **Cloud save and restore:** In authenticated owner session, create non-sensitive sample workspace settings, explicitly save, sign out/reload as appropriate, restore and compare, check tenant isolation and absence of credentials in persisted payloads. Existing issue #43 noted cloud row count zero and owner save/restore unproven.
4. **Sentinel:** Configure a secure reachable persistent endpoint only after verifying service compatibility and authentication; inspect configuration without exposing control tokens. Historically `SENTINEL_URL` and `SENTINEL_CONTROL_TOKEN` were not configured in the deployed project, and no remote Sentinel was proven. Running a service inside a Codespace does not imply it will be online 24/7.
5. **Read-only integrations:** Review and test Bitget in genuinely read-only mode only with owner-approved credentials and appropriate permissions; provider integrations that are guide-only must remain clearly labeled. Do not request or read real exchange secrets for setup without authorization.
6. **Mobile UI:** Validate navigation, overlays, auth, position entry, approvals, persistence and accessibility in an actual iPhone browser; automated desktop builds are not a substitute.
7. **Private access:** Vercel project reports SSO protection enabled, type `all_except_custom_domains`, and older smoke tests intentionally require anonymous access to production pages. Determine exactly which domains/routes are genuinely private and implement owner-only gating where required. A private GitHub repo does not imply a private website.
8. **Live-action safeguards:** An older separate BTCC live-order adapter exists in the codebase behind configuration and confirmation; do not assume all application routes are non-executing. Inspect existing guards, trading-mode flags, risk limits, and request owner approval before any live credential connection or action. Never initiate orders, transfers, withdrawals, follow/unfollow, or funds movement as part of tests.

## Execution rules
- Use **existing Codespace**; do not create another.
- Prioritize free/existing infrastructure. No PC dependency.
- Preserve main application and paper/testnet modes; do not overwrite existing code or infrastructure.
- Keep profits/funds and sensitive actions behind explicit owner approval; **never move money automatically**.
- Report observed, completed, pending, and blocked work separately. Cite GitHub Actions, GitHub PRs, and Vercel deployment IDs when claiming success.
- Do not display, copy, or persist private keys, API secrets, access tokens, or credentials in chat, commits, logs, or screenshots.

## Immediate next action for an agent operating inside the Codespace
Open `.github/prompts/connect-chatgpt.prompt.md`, follow it in Copilot **Agent mode**, start remote device pairing, and request the owner's approval. After device registration, re-check ChatGPT Remote Desktop Commander access and proceed with safe read-only acceptance tests.
