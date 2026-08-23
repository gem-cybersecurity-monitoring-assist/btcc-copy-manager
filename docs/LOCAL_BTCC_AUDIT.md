# Local BTCC Browser Audit

This workflow lets the account owner use a local Chrome session to collect a sanitized, read-only BTCC account snapshot for BTCC Copy Manager.

## Requirements

- Windows with Google Chrome installed.
- Node.js 24+.
- pnpm 10+.
- This repository checked out on `feat/local-btcc-browser-audit` (or a branch containing the feature).

## Run

```powershell
git fetch origin
git checkout feat/local-btcc-browser-audit
pnpm install
pnpm btcc:audit
```

The command opens Chrome with a dedicated local profile at `.btcc-browser-profile/` and asks Chrome to choose an isolated local DevTools port automatically. The runner reads that port only from the dedicated profile's `DevToolsActivePort` file, so it does not attach to an unrelated Chrome debugging session.

Log in to the official BTCC website in the Chrome window. Enter credentials, MFA, CAPTCHA, and any device confirmation only in the BTCC web page. Never enter BTCC credentials in Windows Terminal.

The terminal then guides the account owner through these checkpoints:

1. Account overview / Assets
2. Futures balance and positions
3. My Copy Traders
4. Closed copy-trading history
5. Earn
6. Benefits / Rewards / Trading Funds
7. Funding history
8. Referral / Affiliate
9. Lead-trader marketplace

Navigate to each requested page in the same Chrome tab and press Enter in the terminal. Type `s` to skip a checkpoint.

## Output

Sanitized snapshots are written only to the local machine:

```text
data/btcc-browser/latest.json
data/btcc-browser/snapshot-<timestamp>.json
```

The dedicated Chrome profile and audit output directory are git-ignored.

The snapshot contains:

- visible financial evidence lines relevant to balances, PnL, copy trading, Earn, rewards, funding, fees, VIP, referrals, and trader metrics;
- sanitized BTCC JSON/XHR/fetch responses observed while the user navigates the requested section;
- source URL without query parameters;
- capture timestamps and checkpoint provenance.

Sensitive fields such as passwords, tokens, cookies, API keys, MFA values, secrets, email/phone identifiers, account/user IDs, and credential-like values are redacted before snapshot output.

## Safety boundary

`pnpm btcc:audit` is observational. It does not click or invoke Buy, Sell, Long, Short, Close, Copy, Stop Copy, Transfer, Withdraw, or other value-moving controls. It does not call the existing BTCC live-execution functions.

The existing guarded futures execution path remains separate.

## Session persistence

Chrome uses `.btcc-browser-profile/`, so an authenticated session may persist locally according to BTCC and Chrome session rules. Treat this directory as sensitive local data. Do not upload, commit, share, or copy it to another machine.

If the dedicated audit Chrome profile is already running, the runner may reuse that profile's own DevTools endpoint. Keep the BTCC audit in the same BTCC tab during the guided capture.
