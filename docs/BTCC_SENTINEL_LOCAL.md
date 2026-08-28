# BTCC Sentinel — local one-command startup

The repository now contains the BTCC manager, the local Sentinel service, the deterministic risk/workflow engine, and the authenticated read-only Chrome collector.

## Requirements

- Node.js 24+
- pnpm 10+
- Python 3.11+
- Google Chrome or Chromium

No BTCC password, 2FA code, cookie, API key, or session token belongs in this repository or terminal.

## Start everything

From the repository root:

```bash
pnpm install
pnpm sentinel
```

`pnpm sentinel` automatically:

1. Creates `.sentinel-venv` when needed.
2. Installs the bundled local Sentinel service and its test dependencies.
3. Runs the Sentinel deterministic test suite.
4. Starts Sentinel on `127.0.0.1:8421`.
5. Starts the Next.js BTCC manager on `127.0.0.1:3000`.
6. Verifies the manager-to-Sentinel bridge.
7. Launches an isolated Chrome profile with local DevTools access on port 9222.
8. Waits while you sign into BTCC and complete 2FA in Chrome.
9. Runs the connection doctor.
10. Sends the first credential-safe read-only account/trader snapshot to Sentinel.
11. Starts continuous read-only monitoring.

The only required human authentication step is the BTCC login/2FA in the dedicated Chrome window. Press Enter in the terminal after the authenticated BTCC page is visible.

## Local endpoints

- Sentinel health: `http://127.0.0.1:8421/health`
- Latest normalized state: `http://127.0.0.1:8421/state/latest`
- Alerts: `http://127.0.0.1:8421/alerts`
- Prepared workflow queue: `http://127.0.0.1:8421/workflow/actions`
- Manager: `http://127.0.0.1:3000`

## Safety boundary

The continuous collector is read-only. It reads rendered BTCC DOM text and safe BTCC links and sends normalized observations through the local manager bridge. It does not read cookies, local/session storage, passwords, OTP/2FA values, authorization headers, or form values. It does not click trading or transfer controls.

Sentinel can prepare workflow actions such as bounded copy settings or a Wallet-to-Futures shortfall transfer, but capital-changing actions remain approval-gated. Withdrawals and security/account changes are human-only.

Press `Ctrl+C` in the terminal running `pnpm sentinel` to stop the local Sentinel, manager, and continuous monitor processes. The dedicated Chrome window is deliberately left under your control.
