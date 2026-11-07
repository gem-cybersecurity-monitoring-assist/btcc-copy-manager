# GEM Copy Center — ChatGPT continuation handoff

Verified 7 November 2026. This file is the entry point for a new ChatGPT chat. It records observed results; it does not open a new chat, grant connector access, extend credits, or guarantee an always-on Codespace.

## Start here

- Repository: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager
- Existing Codespace: https://orange-waddle-q7g66xg5p5j5f5q7.github.dev/
- Production: https://btcc-copy-manager.vercel.app/copy-center
- Paper positions: https://btcc-copy-manager.vercel.app/copy-center/positions
- Research: /copy-trading; opportunities: /opportunities
- Existing BTCC control room: /advanced-btcc after the UI release. Root / now redirects to /copy-center.
- Remote connection instructions: .github/prompts/connect-chatgpt.prompt.md

Read this complete file, the connection prompt, and the repository status before changing files. Use the existing Codespace; do not create another or depend on the owner's PC.

## Final UI release — verified

PR #47 merged: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/47
Production source commit: `364ab9ed9fd17387678b5a4e15bd90eebdbe8702`.
Vercel deployment `dpl_s7iDQzMLqbc7nqfppvUwjN3sW2Mf` is **READY**, target production, built in approximately 34 seconds and assigned `btcc-copy-manager.vercel.app`.

Post-release smoke checks passed for /, /copy-center, /copy-center/positions, /copy-trading and /opportunities (HTTP 200); anonymous /api/auth/session reported configured and signed out; /api/workspace correctly denied access (HTTP 401). Root redirects to /copy-center and contains the new headline. /advanced-btcc responds HTTP 200. The live Connect account button was manually checked in the shared browser. CI and smoke checks passed on the merged source commit. The scoped post-release error/fatal log scan returned no groups; this brief observation is not continuous monitoring.

Automatic Vercel Git checks still fail because the project uses a private organization repository on Hobby. The authenticated Vercel API successfully deployed the reviewed commit. No plan/billing upgrade, new project, or new infrastructure was created. Future releases must inspect this limitation rather than assume that a Git push deployed successfully.

The UI redesign is complete and released. Continue with owner authentication and the remaining acceptance list below, not another redesign or repeated pairing. Later documentation-only commits may be newer than the deployed source without changing the released UI. If PR #46 is later merged, preserve this newer handoff when resolving its documentation conflict.

## Owner's current requests

Finish a clearer, easier phone interface and leave a durable continuation report for another ChatGPT chat. Keep existing infrastructure, free/existing services, paper mode, and approval safeguards. Avoid repeated setup and unnecessary credit use. The owner said they do not yet have a GEM cloud account; signup/login and cloud acceptance remain pending.

## Verified terminal access

Desktop Commander device `codespaces-c39052`, ID `2a742b71-6dff-4373-bd15-c6185fb43f24`, was online and executed shell commands in the existing Codespace. A controlled remote-agent process restart reused the saved registration and subsequent commands succeeded. This verifies process restart, **not** a complete Codespace stop/start or rebuild.

New chats must discover the installed Remote Desktop Commander tools and check device status. If online, use start_process directly with the device ID and an explicit working directory. Copilot is a fallback for reconnecting; it is not required to execute every command after the connector works. If offline, use the existing Codespace and the connection prompt. Owner pairing/approval is required only when registration is absent or expired; never fabricate a successful connection.

Persistent-startup work is isolated in draft PR #46:
https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/46
Branch `codex/copy-center-readiness`, commit `cfc5253f0adfe3c04ee5369bfca221a7b0b2ab56`. It pins Desktop Commander 0.3.1, adds a duplicate-safe resume helper and a devcontainer post-start hook. Bash syntax, JSON, typecheck, 103 tests and build passed. The devcontainer hook has not been exercised by a full rebuild or merged. Current-container shell startup invokes the helper. Do not read or print saved remote-device credentials or private logs.

## Checkouts and preservation

- Original: /workspaces/btcc-copy-manager. Existing owner changes to README.md and untracked package-lock.json / next-env.d.ts were preserved.
- Remote-access worktree: /workspaces/btcc-copy-manager-acceptance.
- UI worktree: /workspaces/btcc-copy-manager-ui, branch `codex/copy-center-simple-ui`.
- These are git worktrees in the same Codespace, not new Codespaces.
- Generated next-env.d.ts is untracked; do not accidentally stage unrelated files.
- Node v24.22.2; pnpm 10.28.0; Python3 and authenticated gh are available. rg is not installed; use grep/find/Python as needed.
- Do not symlink node_modules between worktrees: Turbopack rejected the outside-root symlink. Dependencies were copied into the UI worktree.

## UI work completed and locally verified

Initial UI commit: `7d07b66ddbd7f955d2d1476989b3e079d5ceb37d`, followed by a desktop width correction.

- Four primary navigation items: Home, Accounts, Positions, Limits.
- One Connect account entry point. Connections remain separate per provider; there is no universal credential or automatic multi-exchange connection.
- Cleaner cards, readable typography, SVG icons, larger touch controls, and a four-item phone navigation bar.
- Sign in / Join opens the existing GEM account and cloud save/restore controls.
- Optional wallets are collapsed. Unimplemented Farcaster / MT5 status and technical tools are under Settings > Advanced tools.
- Preserved research and opportunity routes. Moved the existing ManagerShell to /advanced-btcc.
- Preserved paper position logic and approvals. Position entry and paper risk settings expand on demand.
- Preserved authentication/API handlers, storage keys, and financial guards; no backend financial capability was added.
- Connection dialogs support Escape, focus containment/restore, and body-scroll lock.
- Fixed legacy global main width causing desktop horizontal overflow, and reset inherited uppercase heading styles.

Validation: pnpm typecheck passed; pnpm test passed **103/103**; pnpm build passed; git diff --check passed. Automated Chromium checks passed at **320x740, 390x844, and 1440x1000**: root redirect, primary navigation, no horizontal overflow, optional wallets, signed-out Bitget gate, modal Escape, signup form, paper create/reject/approve, reload persistence, no API writes and no page errors. Paper examples were confined to disposable browser contexts. These are viewport tests, **not an actual iPhone owner-session acceptance**.

Browser QA tooling was installed under /tmp/gem-ui-qa, outside the repository. System-wide browser dependency installation was rejected by the remote tool. Required official Ubuntu libraries were instead downloaded/extracted into that temporary user-owned directory; no system packages or permissions were changed. Temporary QA files may disappear. The checked-in application gained no new package dependency.

The existing Vercel project is `prj_ddcEn1p6ok6mI8JV4FaJuAacWotJ`, team `team_7lMXW95WSLeyK4yAObe8FptW`.
Initial preview `dpl_C7ZMa6GFsxhzt4YRrVgzrSUZ4uYJ` contains 7d07b66 and precedes the desktop width fix. Do not treat that preview as the final release. Vercel protection remained enabled. A private Codespace preview was used for interactive inspection.

## Remaining acceptance, in order

1. Owner creates/signs into a GEM account and confirms email if required. Verify real production session persistence, logout, and protected API boundaries. Never enter a new password on the owner's behalf or ask for it in chat.
2. In that owner session, explicitly save non-sensitive planning data, reload/restore and compare. Test isolation with separately authorized accounts. Existing table RLS configuration was inspected, but no authenticated owner round-trip or runtime tenant isolation was proven; observed workspace row count was zero.
3. Verify Sentinel service compatibility, authentication and an existing persistent endpoint. Production previously had no SENTINEL_URL / SENTINEL_CONTROL_TOKEN and health returned unavailable. A Codespace process is not a persistent 24/7 service. Do not publish an unauthenticated control endpoint.
4. Bitget verification only with owner-authorized genuinely read-only credentials. No live financial credentials were connected or tested. BTCC remains guide-only.
5. Actual iPhone owner-session checks: navigation, keyboard, overlays, signup/login, cloud restore, paper entry, approval and reload persistence.
6. Owner-only website gating. Private repository and protected previews do not prove the production website is private; existing smoke checks intentionally allow anonymous production pages.
7. Inspect existing live-adapter safeguards without exercising financial routes. AI chat /api/agent remains explicitly disabled; do not claim a working trading AI chat.
8. Review existing dependency security alerts separately. GitHub reported 84 default-branch alerts during push; no broad dependency upgrade was included in the UI change.

## Credit and usage discipline

Start each session from this report and git status; reuse verified commits/tests instead of repeating pairing and setup. Run focused checks after material changes. Avoid duplicate agents, duplicate deployments and background research. Codespaces, ChatGPT and Copilot have separate limits; none of this setup increases quotas or guarantees unlimited/full permissions.

Let the Codespace stop when unused. Do not add keep-alive loops or promise 24/7 uptime. Saved device registration can survive an ordinary agent restart; reconnection still requires the Codespace and connector to be online. Stop temporary preview servers after verification; retain the approved remote connector. Do not stop the owner's work or delete checkouts.

## Non-negotiable financial boundaries

Preserve existing infrastructure, deployments, paper/testnet modes and approval controls. No exchange order, follow/unfollow, transfer, deposit, withdrawal or other money-moving action has been tested or authorized. Do not connect live financial credentials or execute such actions without the owner's explicit authorization. Hidden advanced UI is not a security boundary: the older live adapter still exists behind its existing guards.

## Suggested prompt for a new chat

Continue GEM Copy Center. Read docs/CHATGPT_WORKSPACE_HANDOFF.md completely in gem-cybersecurity-monitoring-assist/btcc-copy-manager. Check the existing Codespace device codespaces-c39052 through Remote Desktop Commander and reuse authenticated terminal access if online. Inspect git status and release evidence, then complete the remaining acceptance tasks in priority order. Preserve paper mode, existing infrastructure and approval safeguards. Do not create another Codespace or connect live financial credentials or move money without my explicit authorization.
