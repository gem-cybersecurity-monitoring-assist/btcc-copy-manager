# Connection audit — 8 November 2026

## Traced controls

| Entry | Handler / boundary | Credentials and result |
| --- | --- | --- |
| GEM account | CopyCenterWorkspace auth → /api/auth/* → server Supabase Auth | GEM email/password for GEM sign-in, not exchange login. Signup does not grant owner access. |
| Cloud restore/save | syncCloud → /api/workspace → owner session/JWT/RLS | Planning payload only; revision-conditional writes, no provider secrets. |
| Bitget | verifyBitget → POST /api/connections/bitget/verify → signed GET /api/v3/account/info then /assets | API key, secret, API passphrase; overall read-only, uta_mgt only. One-time in-memory verification; no recurring connection. Owner gate now precedes provider access and preserves refreshed cookies. Redirects rejected. Empty numeric strings remain unknown. |
| BTCC primary Accounts | Official external links | No credential collection; no verified current native API connection. |
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
