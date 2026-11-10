# Production cutover runbook: btcc-copy-manager → gem-copy-center

This switches the live site `https://btcc-copy-manager.vercel.app` from the old Supabase project `crypto-signal-bot` (`pxcahgcoeewvkhsdvylu`) to the dedicated project `gem-copy-center` (`najhqvsxwbpvadoueced`). It also turns on the read-only connections from PR #93.

The cutover itself was approved earlier ("Yes i approve it", see `OWNER_ACCEPTANCE_AND_DATABASE_CUTOVER.md`) on the condition that the preview is accepted first. No exchange credential, order, transfer or withdrawal is part of this runbook.

## State recorded 10 Nov 2026 (before cutover)

- **Production deployment:** `dpl_HFSJXjEpehFbVUDQ3LWV7mt9L12c` (main `c37c9e3`). This is the rollback target.
- **Shared variables** (targets production + preview [+ development]). They keep their old values; only their targets change.

  | Variable | Vercel env id | Current value |
  |---|---|---|
  | `SUPABASE_URL` | `DlYDkeJp3RseeDTL` | old project URL |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `MQ5vTif7G2iCE6Ax` | old project publishable key |
  | `COPY_CENTER_OWNER_USER_ID` | `Lp4XZUI05ZWRReFy` | owner UUID in the old project |
  | `COPY_CENTER_SITE_URL` | `dVV0XUsrKVA05wRZ` | `https://btcc-copy-manager.vercel.app` (stays as it is) |

- **Already in the dedicated database:** the workspace migrations, `20261110`, the owner account (UUID `b12988d7-…-075780184861`) and the owner workspace copied on 7 Nov.

## Gates (all must be true before any production change)

1. **Preview accepted by the owner.** On the PR #93 preview the owner signs in, and Accounts no longer says "not configured".
2. **PR #93 merged by the owner.** Production then redeploys with the new code on the old database. That is safe: the new panels say "not configured" until the cutover.
3. **Recent changes reviewed.** If the owner changed workspace preferences on production after 7 Nov, they are not in the dedicated copy. Either re-enter them after the cutover or ask the coding agent to copy the workspace again.

## Cutover steps

| # | Who | Action |
|---|---|---|
| A | ChatGPT session (`CHATGPT_PRODUCTION_CUTOVER_SESSION.md`) | In `gem-copy-center`, add the production Auth URLs. In Vercel, add the Production-only `SUPABASE_SERVICE_ROLE_KEY` and a **new, separate** `CONNECTION_SECRETS_KEY`. No redeploy. |
| B | Coding agent | Remove the `production` target from the three shared variables above. Create Production-only `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `COPY_CENTER_OWNER_USER_ID` with the dedicated values (the same values as the preview branch). |
| C | Coding agent | Create a fresh production deployment from `main` and wait for READY. |
| D | Coding agent | Anonymous checks: `/api/auth/session` returns `configured: true`; the connection and workspace APIs return 401; protected pages redirect to `/sign-in`; no runtime errors. |
| E | Owner | Sign in on the live site, restore the workspace, check that Accounts shows no "not configured", then sign out and sign back in. |

**Timing:** steps B and C run back to back. A running deployment never picks up variable changes; only the next deployment does.

## Rollback (about 2 minutes, coding agent)

1. Delete the Production-only `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `COPY_CENTER_OWNER_USER_ID`, `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTION_SECRETS_KEY`.
2. Add `production` back to the targets of the shared env ids `DlYDkeJp3RseeDTL`, `MQ5vTif7G2iCE6Ax` and `Lp4XZUI05ZWRReFy`.
3. Promote or redeploy `dpl_HFSJXjEpehFbVUDQ3LWV7mt9L12c`, or redeploy current `main`.

Nothing is deleted from either database, so a rollback loses no stored data.

## Notes

- **BTCC variables in Production.** Production has encrypted `BTCC_*` variables (`BTCC_API_KEY`, `BTCC_USERNAME`, `BTCC_PASSWORD`, …). After the merge, the owner-only "Check BTCC API now" button uses them for its two read-only calls (login and position list). If they should never be used, set them to empty in Production. Several are of type "encrypted" rather than "Sensitive"; consider re-saving them as Sensitive.
- **Saved connections don't carry over.** Connections saved on the preview are encrypted with the preview key, so the owner saves the read-only Bitget key once more on production.
