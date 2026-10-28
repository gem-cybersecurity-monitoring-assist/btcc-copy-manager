# GEM Copy Center — architecture and validation plan

## Product direction

The default page is the multi-provider workspace. It is designed for phone-first use and separates account visibility, provider setup, allocation planning, and execution tools. The existing BTCC live-order control room remains available at `/advanced-btcc` while the copy-center integration layer is validated.

## Current UI capabilities

- Provider inventory for BTCC and Bitget (exchanges), Phantom and MetaMask (wallets), Base (network), Farcaster (identity), and MetaTrader 5 (trading terminal).
- Explicit connection states. A setup modal does not mark a provider as connected.
- Local-only planning inputs for an intended allocation and illustrative loss threshold.
- Portfolio empty state that does not fabricate balances, positions, provider returns, or trade history.
- Activity records for local workspace actions.
- Mobile navigation, responsive cards, keyboard-operable controls, and reduced-motion support.
- Advanced BTCC control room kept on a separate route.

## Data and safety boundaries

The friendly workspace persists planning settings and its own activity log in the current browser's localStorage. This is a development scaffold, not cloud synchronization. Supabase currently has a `public.copy_center_workspaces` table with row-level security enabled, but the default UI has not yet been wired to authenticated read/write endpoints. No exchange or wallet integration is represented as connected unless a real adapter and authorization check have been implemented.

The current provider inventory is metadata, not proof of exchange capability. Wallets, networks, identity providers, exchanges, and terminals are distinct integration types and must not be treated as interchangeable copy-trading providers.

The friendly workspace does not initiate trades. The existing `/advanced-btcc` route contains live futures order controls and must remain separately reviewed. Never enable live execution based solely on the new visual workspace. Keep exchange secrets server-side, use least-privilege credentials, and require explicit confirmation for any financial action.

## Release gates

1. TypeScript type-check passes.
2. Unit tests pass.
3. Production build passes.
4. Preview route `/` renders on desktop and mobile widths.
5. `/advanced-btcc` remains available and the existing API route set is unchanged.
6. Provider cards show unconnected state until a real connection can be verified.
7. Local persistence survives refresh and reset is explicitly confirmed.
8. Supabase authenticated read/write, row-level security, and cross-device sync are tested separately before advertising cloud sync.
9. Each exchange/wallet connector is validated independently in read-only mode before adding trading permissions.
10. Any real-money feature stays disabled until separately approved and end-to-end tested.

## Next implementation phases

- Phase A: friendly multi-provider shell and separate advanced BTCC route (this branch).
- Phase B: run CI and preview validation; fix type/build/accessibility issues.
- Phase C: add authenticated Supabase workspace API with RLS-backed per-user access and a visible sync state.
- Phase D: implement provider adapters individually, beginning with read-only status/positions.
- Phase E: add provider-comparison metrics only when supported by verified, timestamped source data.
- Phase F: paper-mode validation and independent user approval before any real financial action.
