# Connection audit — 8 November 2026

## Traced controls

| Entry | Handler / boundary | Credentials and result |
| --- | --- | --- |
| GEM account | CopyCenterWorkspace auth → /api/auth/* → server Supabase Auth | GEM email/password for GEM sign-in, not exchange login. Signup does not grant owner access. |
| Cloud restore/save | syncCloud → /api/workspace → owner session/JWT/RLS | Planning payload only; revision-conditional writes, no provider secrets. |
| Bitget | Accounts → POST/GET/DELETE /api/connections/bitget, POST …/refresh (owner-only); one-time POST …/verify retained | Read-only key (readonly/read-only permType, uta_mgt, no uta_trade/withdraw/copy scopes) re-checked on every refresh. Key, secret and passphrase are AES-256-GCM sealed server-side (`CONNECTION_SECRETS_KEY`) in a service-role-only table; never returned to or stored in the browser. Client is GET-only to three allowlisted paths. Positions refused by Bitget are shown unavailable, never zero. See BITGET_READONLY_CONNECTION.md (10 Nov 2026). |
| BTCC primary Accounts | Accounts/Positions → GET /api/connections/btcc, POST …/check, POST/DELETE …/import (owner-only) | No credential collection in the browser. Adapter reports provider_unavailable with the 13 Feb 2026 suspension reason; an owner-triggered check (server env credentials only) may call login + position list, nothing else. Owner CSV imports (balances, positions, copy history) are strictly validated and always labelled "owner-imported, not live". See BTCC_READONLY_ACCOUNT.md. |
| Legacy BTCC Connection | Advanced ManagerShell → owner-protected live/status | Removed conflicting credential/activation checklist. Configuration is not proof of provider support. Financial web execution hard stop remains. |
| Phantom | connectWallet → injected phantom.solana.connect | Public address consent only; no signature or transaction. |
| MetaMask | connectWallet → eth_requestAccounts | Public address consent only; no balance verification. |
| Base | connectWallet → eth_requestAccounts, chain switch/add, eth_chainId | Wallet/network consent; no transfer. Not an exchange account or balance feed. |
| Farcaster / MT5 | Advanced setup notice | Unsupported adapters; no authenticated connection. |
| Browser / Steel / purchase | Secondary tools → existing owner-wrapped APIs | Separate legacy tools, not official exchange API connections. No activation performed. |

## Official documentation rechecked

Browser GETs returned 200 on 8 November for Bitget account-settings, assets-balance and UTA quick-start catalog pages. Account settings explicitly lists read-only/read-and-write, uta_mgt, uta_trade, withdraw and futures copy scopes. Quick Start specifies APIKey, SecretKey and ACCESS-PASSPHRASE set at API-key creation. The strict existing assets-only contract remains unchanged; no broader scope is recommended.

https://www.bitget.com/docs/catalog/account/account-settings
https://www.bitget.com/docs/catalog/account/assets-balance
https://www.bitget.com/docs/uta/quick-start

BTCC official notice https://www.btcc.com/en-US/detail/176811 returned 200 and states futures API suspension starting 13 February 2026 pending restoration announcement. This does not prove no later restoration exists; current support remains unverified. No invented native copy endpoint or browser-as-official-API claim is accepted.

The previously spoken Bitget passphrase must not be reused. Before any separately authorized read-only provider test, replace the affected API credential through Bitget's secure API-management flow and enter the replacement only through a secure provider/application form. No credential was requested, retrieved or used in this audit.

## Evidence and limits

Local built-app synthetic HTTP checks cover nonowner credential-route rejection and refresh-cookie preservation without calling Bitget. Full web tests/build and Sentinel tests run separately. Browser viewport results are synthetic local sessions, not real hosted JWT, iPhone Safari or exchange acceptance. Official USD aggregate equity remains distinct from USDT. Funding/cash-flow reconciliation, durable observations, missing positions/fills and actual net returns remain unavailable where evidence is absent.

The legacy capabilities API also claimed VERIFIED native copying without current acceptance. It now requires the owner and returns unverified provider capability and blocked execution regardless of configuration. Mounted HTTP tests assert these states.


## Update — 10 November 2026

Bitget moved from a one-time check to a persistent, re-verifiable read-only connection (see `BITGET_READONLY_CONNECTION.md`). The previously separate `src/lib/bitget-readonly.ts` check had drifted from the route (it still rejected Bitget's live `readonly` permType); both now share one implementation, matching the #92 rule. Storage is inactive until the server-only keys are set in Vercel and migration `20261110` is applied to the dedicated project. No credential was requested, entered or used in this change; all provider and database behaviour was exercised with synthetic fixtures and a disposable local PostgreSQL.
