# Cross-device cloud sync

Copy Center preferences follow the signed-in owner across devices automatically. No manual Save or Restore is needed.

## What syncs, and what never does

**Synced** through `PUT /api/workspace`, using the server whitelist in `normalizeCopyCenter`:
- planning amount
- loss threshold
- activity log (up to 50 entries)
- public wallet addresses

**Never synced** through the workspace:
- exchange API keys, secrets and passphrases
- MT5 investor passwords
- connection state, balances and positions
- BTCC imports

Those live server-side behind their own owner-only routes. Every device reads them from the server, so they are the same on every device without travelling through the workspace. The sync code only sends the whitelisted preferences, and the server rejects or strips anything else. Tests in `tests/cloud-sync.test.ts` enforce both.

## How it works (`lib/cloud-sync.ts`, workspace component)

1. **On sign-in.** The workspace reads the cloud copy and compares three things: this device's preferences, the cloud copy, and what this device last synced. The last-synced record is stored per user in `localStorage` and is ignored if a different account signs in. The outcome:
   - Only the cloud changed: the cloud copy is applied here.
   - Only this device changed: this device's copy is saved to the cloud.
   - Both changed: a **"Two versions of your preferences"** prompt appears in Settings, and nothing is overwritten until the owner chooses.
   - A fresh device that is still on the defaults simply takes the cloud copy.
2. **After an edit.** About 2 seconds after the last change, the preferences save automatically. Saves only succeed against the cloud revision this device last read, so a write that happened in between returns 409 and the device reconciles again rather than overwriting. Changes elsewhere in the workspace (for example trader research) do not count as conflicts.
3. **When the tab regains focus.** The workspace checks the cloud again, so a change made on another device appears.
4. **On failure** (offline, rate limit, server error). Changes stay on the device, the status line says why, and sync retries automatically after 30 seconds, as well as on the next edit or focus.

**Status** shows in Settings (Synced / Changes will sync / Saving / Not synced: reason / Needs your choice) and on the Home tile.

## Verification

- `node --test tests/cloud-sync.test.ts` covers the decision rules, the whitelist and user-bound metadata.
- To run the two-device browser acceptance against the local synthetic fixture:
  ```
  GEM_QA_BROWSER_SCRIPT=scripts/qa-cloud-sync-browser.mjs node scripts/test-owner-boundaries.mjs
  ```
  Optional: `GEM_QA_PLAYWRIGHT_MODULE`, `GEM_QA_CHROMIUM_PATH`.

  The script checks that a change saves automatically on device A and restores automatically on device B; that B's change reaches A on focus; that an offline edit on A plus a concurrent edit on B produces the conflict prompt while the cloud is left untouched; and that "Keep this device's version" then saves.

This is synthetic local acceptance only. Hosted cross-device acceptance requires the owner's real session on the deployed site.
