# Owner acceptance and dedicated database cutover

## Verified checkpoint — 7 November 2026

The intended owner confirmed the registered, email-confirmed account whose trusted Auth UUID ends `f24e6c52`. A read-only database audit found one saved Copy Center workspace for that UUID, with sign-in and save timestamps on 7 November. The server-only Vercel `COPY_CENTER_OWNER_USER_ID` setting has been configured for Production and Preview. No password or exchange credential was requested, exported or committed.

The existing application still uses `crypto-signal-bot` (`pxcahgcoeewvkhsdvylu`). Its account records and workspace were preserved. A new dedicated project, `gem-copy-center` (`najhqvsxwbpvadoueced`, us-east-1), was created in the owner-selected support371 organization after a $0/month cost quote. It is ACTIVE_HEALTHY, with no public tables and no registered users at the audit checkpoint. This is a prepared destination, not a completed migration. No hosted migration, account transfer or production database switch has been performed.

## Release changes and local verification

Protected dashboard routes now require the verified server-side owner identity. Public `/account` and `/sign-in` reuse the existing account interface. Registration does not confer owner privileges. Legacy BTCC, purchase, browser-session and Steel API handlers authorize the owner before invoking their existing backend. The web financial execution handlers additionally refuse execution with `approval_ledger_not_ready`; owner login alone is insufficient authorization.

Cloud saves use conditional database updates matching the owner and the exact revision read by the client. New rows use insert, not unconditional upsert. Missing versions are rejected (428); races return 409 and keep the browser's local records. Both cloud interfaces carry revision evidence. The service worker no longer caches authenticated responses and removes its older response caches on activation. Logout navigates away from private financial views.

Executed locally in the existing Codespace:

- `pnpm check`: TypeScript, 167 tests, and production build passed.
- `node scripts/test-owner-boundaries.mjs`: 22 mounted API methods and nine page redirects passed with synthetic owner/ordinary/revoked/outage sessions. Checks include refresh-cookie attributes, CSRF, logout, concurrent saves, blind-save rejection and the financial hard stop.
- Chromium at 320, 390 and 1440 pixels: synthetic signup confirmation, sign-in, restore, save, second-session conflict, seven views, the read-only Bitget form, logout, no horizontal overflow and no JavaScript errors passed. Public research feeds were deliberately unavailable in this isolated fixture. No API key was entered.

These are real tests of the built application with a local synthetic Auth/database fixture. They do not prove production email delivery, hosted RLS, real owner refresh/restore, Safari behavior, exchange authentication or live financial reporting. The browser script is `scripts/qa-owner-browser.mjs`; install Playwright outside the application and pass its module path with `GEM_QA_PLAYWRIGHT_MODULE`, plus `GEM_QA_BROWSER_SCRIPT` to the runner. The HTTP fixture runs in CI after the build, uses ephemeral localhost TLS, excludes ambient provider credentials, and cleans up its child processes and certificates.

## Smallest production read-only acceptance

1. Signed out: open `/sign-in` at 320 and 390 pixels. Private dashboard routes must redirect there; `/api/workspace` and `/api/v1/ledger/snapshots` must reject anonymous requests. Do not use a successful page status as authenticated acceptance.
2. Owner signs in through the existing website. Verify `/api/auth/owner` returns authorized; an ordinary account must receive 403. Observe session refresh and sign-out through the UI without copying cookie values or passwords into chat/logs. Recovery email delivery and expired confirmation links require real mailbox acceptance separately.
3. In Settings, restore the saved workspace and compare its non-sensitive preferences/counts. Do not save as part of the initial read-only check. Sign out, sign back in and restore again. In a second authenticated browser, confirm the same cloud revision and content. A deliberate write/conflict acceptance may follow only using a harmless preference, with a backup and owner awareness; it is not part of the read-only runbook.
4. Sentinel: inspect health, configured remote URL and freshness only. Do not invoke `/scan`, ingestion, browser automation or any endpoint that may call an executor. Missing remote URL/control token, ledger tables or a durable worker means monitoring is not operational. A Codespace timer is not 24/7 hosting.
5. Mobile: navigate Accounts, Traders, Positions, Performance, Risk and Automation; inspect narrow layouts, visible errors, labels, focus and stale-data states. Review proposals without execution. Missing exchange credentials must produce an unconnected state, never synthetic financial performance presented as real.
6. Sign out. Revisit protected pages and read APIs; they must reject access and show no cached cloud response. This does not erase owner-created local preferences from the device.

No financial credential connection, order, follow/unfollow, transfer or withdrawal is included in this runbook.

## Concrete migration proposal — requires owner approval

Approval requested is for this destination and sequence, not a password transfer:

1. Apply the existing reviewed workspace migrations (`20261024`, `20261025`) and repaired Sentinel ledger migration (`20261107`) to the empty `gem-copy-center` project only. Configure Auth production/preview URLs and confirmation behavior without touching Crypto Signal Bot.
2. Use a protected preview against that project. The owner registers and confirms the same intended email directly; derive its new UUID from trusted Auth records. No password/hash export, unsolicited recovery email or old-account deletion.
3. Copy only the confirmed owner's existing workspace to the new UUID, validating payload checksum, row count and revision. Preserve the source record and record a rollback checkpoint. No other account is copied.
4. Validate actual owner and separate test-user sessions against hosted RLS, restore/persistence, refresh/logout, account recovery and tenant isolation. Implement and test the Sentinel persistence adapter before describing the ledger as operational.
5. Switch the existing Vercel project to the dedicated project and its newly verified owner UUID only after preview acceptance. Deploy the reviewed main commit and recheck the canonical site. Retain the old configuration for rollback; never print credential values.

Do not perform steps 1–5 until owner approval is recorded. No paid resource, exchange credential or financial execution is included. If the current free-project capacity changes, stop before incurring cost.

## Remaining operational dependencies

PR #76 adds truthful Bitget read-only evidence and redacted errors; it does not connect an account or wire those records into production dashboards. Funding/cash-flow reconciliation and execution-grade daily PnL remain unavailable. Dedicated ledger persistence, scheduled durable monitoring, actual tenant acceptance, owner production session round-trip and real provider records remain unverified. Existing paper mode and financial approval safeguards must remain in place.
