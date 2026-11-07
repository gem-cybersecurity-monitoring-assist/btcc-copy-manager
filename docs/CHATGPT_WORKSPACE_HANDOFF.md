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
- UI worktree: /workspaces/btcc-copy-manager-ui. UI branch: `codex/copy-center-simple-ui`; current checkout: `codex/copy-center-release-evidence` for the documentation-only release record.
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


## New owner discussion — performance intelligence expansion (7 November 2026)

This section updates the prior continuation instructions; it **does not** authorize deploying code, enabling live trading, or changing risk limits. Read it with docs/GEM_RISK_ADJUSTED_PERFORMANCE_ENGINE.md from PR #48: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/48 (PR open; not merged at the time of this handoff). Do not assume PR #48 is present on main.

**User's objective:** GEM Copy Manager should use substantially more than passive single-trader copying: select and continuously reassess strong traders, combine verified exchange-specific strategies, independently evaluate market liquidity and volatility, monitor broad economic events and growth/regime indicators, allocate capital intelligently, and stop or rotate deteriorating traders. The user wants **daily percentage returns** measured against capital, with upside pursued aggressively but with controls. Any 5% calculator figure was illustrative, **not** a system return ceiling or forecast. Do not promise daily rates such as 5%, 10% or 20%; use observed net performance and drawdown.

**Proposed architecture to discuss before implementation:** (1) trusted account/trader collector and provenance; (2) trader-quality scoring and survivorship-aware history; (3) order-book depth, spread, slippage, volume, volatility, funding and open-interest analysis; (4) economic/event regime context and charting; (5) independent AI review with deterministic veto-only risk gates; (6) cross-exchange strategy comparison without cross-account balance assumptions; (7) paper execution, fee-aware equity accounting, real-time portfolio risk and audit; (8) mobile dashboard daily net ROI, realized/unrealized PnL, maximum drawdown, capital usage, rejected opportunities, and data freshness.

**Rollout order for owner approval:** A. Baseline and tests: verify latest main, PR #37 discovery contract, PR #48 document and existing Sentinel/React changes; preserve all three existing worktrees and uncommitted work. B. Implement pure performance/ROI/drawdown/fee calculations and independently test them. C. Add read-only market/liquidity/economic adapters and a multi-review decision report; fail closed on unavailable feeds. D. Paper-trading walk-forward and stress tests versus simple copy-trading baseline; monitor execution costs, fills, drawdowns and outages. E. Expose bounded results and explanation in the existing mobile UI, without merging unrelated BTCC and crypto-signal-bot systems. F. Reassess verified exchange capability, durable backend and owner authentication before proposing any live rollout.

**Safety/hosting invariants:** existing 50% reserve, 20% max total copy allocation, 5% max per trader, 3 traders, 3x execution leverage stay in force unless the owner approves change after test evidence. No deposits, transfers, order submission, funded follows, API trading credentials, withdrawals, billing changes, new paid infrastructure or 24/7 keepalive. Stop-loss is not guaranteed at the trigger price. Current Next.js /api/agent explicitly responds not configured; ChatGPT Remote Desktop Commander access to the Codespace does **not** activate that endpoint or create an always-running agent.

**Current handoff access verification (this conversation):** Remote Desktop Commander device codespaces-c39052 online; Codespace /workspaces/btcc-copy-manager main is behind origin/main by seven commits with the owner's modified README and untracked files. /workspaces/btcc-copy-manager-ui is on codex/sentinel-readonly-boundary with ongoing uncommitted backend changes, and /workspaces/btcc-copy-manager-acceptance is on codex/copy-center-readiness. Do not force-pull, reset, switch branches across worktrees or stage unrelated edits. The owner asked to discuss the above plan **before building the new engine**. Next ChatGPT session should read this handoff, inspect status and ask for confirmation of the implementation sequencing, then implement the agreed paper/read-only phase directly using the existing authenticated remote device.


## Owner scope correction — live-product delivery, not paper-first (7 November 2026)

**This supersedes any suggestion in the new performance-intelligence section that the product should be built as a paper-trading-first project.** GEM Copy Manager is distinct from Crypto Signal Bot. The requested production deliverable is a **usable live-capable, multi-exchange copy-trading platform** with working provider connections where supported, verified trader discovery, strategy/risk intelligence, account and position monitoring, daily net ROI and economic/liquidity analysis, and explicit owner approvals for sensitive actions. Build the actual supported integration paths and production-grade service boundaries, not only simulations, conceptual dashboards, or documentation.

**Website experience requirement:** the primary iPhone interface must be a functional Home / Accounts / Traders / Positions / Performance / Risk experience as appropriate. Do **not** show engineering setup guides, review runbooks, developer checklists, paper-mode tutorials, unimplemented marketing claims, or technical integration instructions as the main website UI. Keep operator runbooks and validation evidence in private docs/CI, and show only actionable owner-facing connection, authorization, readiness, account status and error states in the product. Preserve advanced controls when needed for real users, but avoid clutter.

**Important distinction:** live-capable code and a production-ready dashboard are requested, but this is **not** authorization to place orders, follow funded traders, enable money-moving API scopes, transfer balances, withdraw, raise leverage/exposure limits, incur paid hosting costs, or bypass exchange eligibility/permissions. Implement and validate read-only and sandbox/contract tests internally where necessary without making paper mode the requested product. User approval is required before consequential live financial actions. Unsupported exchange APIs must be labeled accurately and not simulated as live execution.

**Execution priorities for workspace agent:** (1) inspect the latest merged UI, local worktrees, and in-progress owner-auth/Sentinel boundary changes without overwriting them; (2) remove guide/review/setup content from the primary owner-facing UI where present, replacing it with functional status and actions; (3) build fee-aware daily performance and market/liquidity/economic intelligence; (4) complete supported authenticated live exchange read paths, native copy-operation wiring and safe owner approval gates; (5) verify production authentication, durable monitoring and deployment; (6) perform real functional acceptance of the mobile website, without executing trades or moving funds. Do not describe unimplemented modules as complete. No new Codespace or paid service unless separately approved.


## Verified live-product work completed after the discussion (7 November 2026)

**Implemented and merged:** PR #50 https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/50, production source commit `c21b9892772492292e13dd8840f002838b2c02b7`. A separate worktree at `/workspaces/btcc-copy-manager-performance` was created from origin/main, leaving owner's work in the original main, UI and acceptance worktrees intact. The PR replaced the homepage's paper-first hero with trading-control messaging, added a working Performance view for recorded equity snapshots, implemented pure flow-adjusted return/drawdown functions and tests, added a real read-only CoinGecko market overview with BTC/ETH/SOL price, 24h change, volume, market capitalization and timestamps, and removed seeded fake trader opportunities and synthetic current-looking market-status claims. The opportunities monitor now shows no verified candidates until provider discovery is wired.

**Validation actually run:** pnpm typecheck passed; all 110 Node tests passed; pnpm build passed; git diff --check passed; GitHub CI check, Sentinel tests and smoke checks passed. Vercel automatic Git checks still fail because private-org Git integration is unsupported by the existing Hobby plan; this is an infrastructure restriction, not a code-test failure. Authenticated Vercel API production deploy `dpl_GkP5pkQdd9ViUULETXaBWaZF4SUm` reached READY, alias `https://btcc-copy-manager.vercel.app`, without plan upgrade. Remote HTTP smoke: /copy-center, /copy-trading, /opportunities, /api/v1/market/overview, /api/v1/opportunities and /api/auth/session returned 200; market overview returned 3 source-labeled assets; signed-out /api/workspace returned expected 401. Smoke tests do not prove an authenticated owner's full iPhone session or a live trading connection.

**Still incomplete, do not claim otherwise:** verified account-specific positions/balances persistence, executable native copy operations for a user-approved account, exchange-specific live order-book liquidity, economic calendar/regime charting, cash-flow/fee reconciliation to produce actual net daily ROI, all-hours monitoring and user-accepted live trading. Existing current copy settings and local risk planning are not connected to all venue-side controls. The included flow-adjusted mathematics is not yet wired to verified external cash-flow records. Do not imply the displayed CoinGecko reference volume is usable exchange order-book liquidity.

**Next agent tasks:** use existing Codespace through Desktop Commander when online; check git status and preserve all worktrees, including the live performance branch. Audit the current production and the in-progress sentinel owner-auth boundary work; implement persistent owner-authorized read-only trade/position synchronization and reconciliation first, then exchange-specific trader discovery and true economic/liquidity feeds. Keep UI actionable, not guide-first. Keep existing explicit approval controls; no unapproved trades, transfers, deposits, withdrawals, secret exposure, paid services or altered risk limits. Production must be reverified after further deployments.

  
## Full-page usability and navigation release — 7 November 2026

**Merged and deployed:** PR #51 https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/51, production commit `6ae1fa4d581d985c98ee15f15ac028a4ae10175c`, Vercel deployment `dpl_Him7Ay3M9NeC3w5zsCpWPbs3crEL` READY, production alias https://btcc-copy-manager.vercel.app. No paid plan or new project was created.

**Audit scope:** seven production pages: /copy-center, /copy-center/positions, /copy-trading, /opportunities, /advanced-btcc, /purchase, /steel. Headless Chromium QA at widths 320, 390, 1440 px. Baseline found no cross-dashboard links on several pages and a 12 px iPhone-width overflow on /copy-trading. New shared navigation links Home, Accounts, Traders, Opportunities, Performance, Positions; advanced BTCC, finite purchase, browser session and local paper positions are secondary tools. The Copy Center phone bar has five items including Performance. Direct links /copy-center?view=providers and ?view=performance and ?view=portfolio now load the correct view. Fixed mobile overflow while preserving scrollable analytical tables and tab strips.

**Additional UI corrections:** removed fabricated demo trader profiles and show-demo control from the visible trader research screen, leaving user-entered records visibly labeled as not exchange-verified. The opportunities dashboard has a truthful no-feed empty state with links to Accounts, Trader Records and Performance; it handles provider errors, and GET /api/v1/opportunities includes market/scanned metadata. Preserve existing paper position/approval tools as secondary tools; do not rename them as live exchange positions.

**Validation performed:** pnpm typecheck, pnpm test (110/110), pnpm build, git diff --check. Local browser tests: 7 routes x three viewport widths, deep-link/section navigation, no horizontal overflow, no page errors or financial API writes. Additional local QA tested wallets, read-only Bitget signin gate, modal Escape, signup form, existing paper-position create/reject/approve/reload. Post-release browser tests repeated all seven routes x three widths on the actual production alias and passed; /api/v1/market/overview returned 3 real public market assets; /api/v1/opportunities returned zero fabricated trader candidates; signed-out /api/workspace returned expected 401.

**Preserved owner work:** isolated git worktree `/workspaces/btcc-copy-manager-accessibility` on branch `feat/unified-mobile-navigation`; original `/workspaces/btcc-copy-manager` contains owner README and untracked files; UI `/workspaces/btcc-copy-manager-ui` has uncommitted Sentinel authorization work; acceptance `/workspaces/btcc-copy-manager-acceptance` is separate; performance `/workspaces/btcc-copy-manager-performance` exists. Do not reset, force-pull or overwrite. Desktop Commander Codespace device `codespaces-c39052` was online and used to execute validations.

**Still not complete:** authenticated owner acceptance and cloud persistence, server-side Sentinel owner/session boundary finalization, durable exchange position/trade and fee/cashflow syncing, supported native copy actions with owner approval, verified trader data sources, true order-book liquidity, economic indicators and 24/7 monitoring. Do not represent absent live data or account permissions as connected. Vercel automatic Git integration still fails on private-org/Hobby; actual deployment required authenticated Vercel create_deployment; verify every new release. The user wants a cohesive finished live-capable platform, not a guide-first or paper-first website.

**Next ChatGPT agent step:** read this file, inspect git status in each worktree, and continue high-priority backend owner-auth/Sentinel integration and end-to-end real account connectivity while preserving the improved UI. Do not move money, place orders, enable financial credentials, incur paid services or weaken existing safety gates without explicit authorization.


## Automation, research handoff, local assistant and framework-security release — 7 November 2026

**Current production:** https://btcc-copy-manager.vercel.app — verified Vercel deployment `dpl_DbLe5XUtcu3gVHinB1RDhhC6GQmt` READY, GitHub source `be072c73621b8307ca71e7a5cda2ddf18d404fc3` (PR #61). Existing Vercel Hobby private-org Git auto-deploy is restricted; the authenticated deployment tool/API was used explicitly. No paid upgrade or other Vercel project was created.

**Completed in merged PRs #53–#61:**
- #53: /automation operational overview, service connectivity checks, deterministic browser-side periodic risk reviews while the website is open, manual review and stored audit, navigation/deep links to existing tools; no always-on server claim.
- #54: owner-only Sentinel web routes, read-only GET /review/latest replacing an unsafe GET that called POST /scan, collector web forwarding disabled because ingestion could execute, backend control authentication required for non-health endpoints. The server-only COPY_CENTER_OWNER_USER_ID remains unconfigured in production.
- #55 and #60: spot order-book spreads and up to ten levels of quoted depth for BTC/ETH via Bitget, Kraken, OKX and Gate; stale/crossed data omitted and USD versus USDT distinct. On production some providers are intermittent; the endpoint can return partial data and no execution assumptions.
- #56: read-only published annual USA GDP growth, CPI inflation and unemployment charts from the World Bank. Latest reporting years vary, with no claim of real-time signals.
- #57: read-only Kopyon aggregator 30-day public trader rankings for Bitget and Gate, conservative screening statuses, native exchange execution identifiers never inferred or authorized.
- #58: single-click copy of candidates into the browser-local strategy research engine as non-verified summary observations only. Duplicate prevention, audit and schema validation, no eligible allocation without return history.
- #59: free deterministic local agent fallback in the chat tab, grounding answers in the already implemented risk, allocation, eligibility, monitoring and backtest functions. It is NOT a generative LLM or a trade executor, and makes no financial API writes. Existing optional remote model approval flow remains gated.
- #61: Next.js 16.1.6 -> 16.4.5 and transitive source-map-js override to 1.2.2. Local `pnpm audit --json` was 4 critical, 20 high, 18 moderate, 4 low before the upgrade and ZERO findings of every severity after. GitHub's historical Dependabot alert count (84 reported during pushes) may be different and has not been verified cleared.

**Actual validation:** 136 Node tests and `pnpm check` (typecheck/build) passed with upgraded Next 16.4.5; Sentinel Python CI and web smoke CI passed for the merged code. After latest production READY, Playwright tested 7 routes at widths 320, 390 and 1440 px; local agent UI and research import flows passed in production, with zero page JS errors, horizontal overflow or financial API writes. Signed-out workspace still rejects privileged APIs; authenticated owner trading not yet acceptance-tested.

**Critical remaining work, do not claim completed:** the production Copy Center Vercel environment has no observed `SENTINEL_URL`, `SENTINEL_CONTROL_TOKEN` or `COPY_CENTER_OWNER_USER_ID` entries (names-only audit; no secret values read). Supabase authentication itself is configured, but a signed-in owner session has not been verified. A separate older Vercel project named `sentinel` exists but is NOT verified as a persistent 24/7 worker. No persistent authenticated Sentinel execution service, secure owner-specific positions and fills sync, 24/7 scheduler, native Bitget copying confirmation, BTCC supported native copy API verification, proof of risk-limit/stop-loss execution, trusted native trader ID mapping, live credentials acceptance or reconciled actual fee-adjusted daily ROI. Do not connect old service or enable actual financial actions without verifying its data store and security. The user's other Supabase projects must not be repurposed or resumed without confirming intended scope/data. Kopyon rankings are public third-party observations, NOT exchange-authoritative performance. No orders, deposits, transfers or withdrawals were attempted in this release session.

**Next agent execution order:** inspect existing worktrees and preserve owner changes; securely validate login/owner UUID and persistent store plan, audit Sentinel backend deployment and add isolated durable owner-scoped data, wire authenticated read-only exchange balances/positions/fills, implement server-side bounded monitoring with stale-data fail-closed and alert delivery, reconcile fees/cash flows to true net PnL, then implement only separately approved provider-specific native copy operations with idempotency and explicit owner approval. Continue to use current Codespace via Desktop Commander as development terminal, not as a guaranteed persistent production server. Maintain a cohesive iPhone-friendly dashboard without setup-guide clutter, keep GEM Copy Manager isolated from Crypto Signal Bot and GEM Enterprise.


## Production hardening and durable Sentinel preparation — 7 November 2026

**Verified production UI deployment:** `dpl_Df9XBtciRazreLC73LbpHeMXjVL7` is READY and aliased to `https://btcc-copy-manager.vercel.app` at commit `9c49fbbfc9bba323a9145b97945b38527997a4cb` (#66). Current repository main also includes the subsequent *schema-only* PR #67; that migration has deliberately not been applied or deployed to Supabase.

- **#63:** removed 11 legacy unauthenticated internal GET diagnostics that could create billable browser sessions, submit stored BTCC credentials or expose Steel profile metadata. Clean GitHub CI passed after test was adjusted for a deleted directory. Production route tree no longer includes those handlers.
- **#64:** removed two hardcoded recovery passphrase digest checks from Steel controller auth, preserving server-configured Steel and legacy secret authentication. CI passed; no user credential values read.
- **#65:** corrected dead `/advanced-btcc` navigation links to existing `/steel` controls, removed unused start guide and public practice-trader loader, replaced preview label and removed onboarding checklist. Kept optional existing sample cleanup. CI passed and production deployed.
- **#66:** added a combined read-only decision engine in Automation that computes strategy eligibility, unresolved portfolio alert vetoes, fresh source-checked multi-exchange spot liquidity evidence, and persistent Sentinel health. `executionPermitted` is always false: public spot depth cannot authorize native futures copying, and a green observation cannot override missing owner data. Unit tests and full GitHub CI passed; production deployed as above.
- **#67:** staged **unapplied** owner-scoped Supabase ledger migration under `supabase/migrations/20261107_gem_copy_sentinel_ledger.sql` and developer notes at `docs/SENTINEL_OWNER_LEDGER.md`. Six RLS-protected tables cover connections, official balances, source-labeled trader observations, durable monitor runs, idempotent approved actions and append-only audit. CI static schema contract tests passed. No project was created, selected, repurposed or mutated.

**Current integration blocker:** Codespace Desktop Commander `codespaces-c39052` became offline during this session, so later changes were delivered via the connected GitHub and Vercel actions, and tested through GitHub Actions. Do not claim an iPhone visual Playwright pass for #66 because the remote browser became unavailable. Vercel deployment status was verified READY; pre-existing routes had earlier visual browser tests. Vercel returned no aggregated runtime errors in a recent production lookup.

**Next high-value actions:** (1) verify the user-owned isolated Supabase destination and apply the prepared migration only there, after schema/data review; (2) implement the Sentinel Postgres persistence adapter and server-side owner context, with no arbitrary `user_id` accepted from clients; (3) deploy a truly persistent, controlled scheduler with reliable per-owner service authentication, stale-data checks, deduplication and owner notifications; (4) wire authenticated read-only account balances and trade/fill/fee reconciliation; (5) independently validate official native copy API and native trader project IDs before approval-gated financial mutations; (6) perform full iPhone visual acceptance after Codespace or browser reattaches. Do not equate successful public market research with continuous execution. Do not handle withdrawals automatically. Keep this repository and database separate from GEM Enterprise and Crypto Signal Bot.
