# Agent instruction: server keys for read-only connections (Preview only)

You are configuring two server-only secrets so that the Stage 1 read-only connections (PR #93) can store data. You will see secret values. Handle them exactly as described below.

## Hard rules (read before doing anything)

1. **Never reveal a secret value.**
   - Do not print, echo, log, screenshot, copy into chat, or put a value in a PR, issue, commit, file, ticket or message.
   - Do not read a value back once it is saved. Report variable **names** only.
2. **Never commit anything to the repository.** Never give a secret a `NEXT_PUBLIC_` name, because that would ship it to browsers.
3. **Do not change Production.** Production still uses the old Supabase project, `crypto-signal-bot` (`pxcahgcoeewvkhsdvylu`). A service key for the new project placed next to the old URL would break the app. All changes in this task are **Preview, scoped to one Git branch**.
4. **Do not touch these:**
   - any Supabase project other than `gem-copy-center` (`najhqvsxwbpvadoueced`, support371 organization);
   - any exchange account or API key;
   - any trading, transfer, deposit or withdrawal setting.
5. **Do not apply database migrations.** The repository's coding agent does that after you report back.
6. **Stop and report if anything differs from what is described here.** For example, the project is missing or paused, the branch-scoped settings are not where described, or a step would cost money. Do not improvise.

## Context

- Vercel project: `btcc-copy-manager` (team `admin-25521151s-projects`).
- Dedicated database: Supabase `gem-copy-center` (`najhqvsxwbpvadoueced`). The workspace migrations are already applied there, and the owner is already registered there.
- An existing **branch-scoped Preview** configuration for Git branch `feat/dedicated-database-preview` already points the app at `gem-copy-center`. It includes `SUPABASE_URL`, the dedicated project's public anon/publishable key, the dedicated owner UUID in `COPY_CENTER_OWNER_USER_ID`, paper-mode settings, and empty overrides for inherited provider, browser and control credentials.
- PR #93 is on Git branch **`claude/copy-center-real-accounts-1jsir9`**. Its previews currently inherit the shared Preview settings, which point at the old project.

## Steps

### 1. Give the PR branch the same dedicated Preview configuration

In Vercel → `btcc-copy-manager` → Settings → Environment Variables:
- Find every Preview variable scoped to branch `feat/dedicated-database-preview`.
- Add the same variables, with the same values, scoped to Preview and branch `claude/copy-center-real-accounts-1jsir9`. This includes the empty overrides, which must stay empty.
- Enter values through Vercel's form only. Do not paste them anywhere else.
- Do not change the existing `feat/dedicated-database-preview` variables or any Production variable.

### 2. Add the Supabase server key (Preview, branch `claude/copy-center-real-accounts-1jsir9` only)

- In the Supabase dashboard → project `gem-copy-center` → Project Settings → API Keys, copy the **secret** key. Either the new `sb_secret_…` key or the legacy `service_role` JWT is accepted.
  - Use the key for `gem-copy-center` only.
  - Do not create, rotate or revoke keys unless the owner asks.
- In Vercel, add `SUPABASE_SERVICE_ROLE_KEY`:
  - Environment: **Preview**, Git branch **`claude/copy-center-real-accounts-1jsir9`**.
  - Mark it **Sensitive**.

### 3. Add the encryption key (Preview, same branch only)

- Generate 32 random bytes on your own machine:
  ```
  openssl rand -base64 32
  ```
  Paste the output directly into Vercel and then discard it. Do not save it to a file or paste it anywhere else.
- In Vercel, add `CONNECTION_SECRETS_KEY`:
  - Environment: **Preview**, Git branch **`claude/copy-center-real-accounts-1jsir9`**.
  - Mark it **Sensitive**.
- Do **not** set `CONNECTION_SECRETS_KEY_VERSION`; it defaults to 1.
- Note: if this key is ever lost or changed without the rotation procedure in `docs/BITGET_READONLY_CONNECTION.md`, saved connections must be re-entered. Production will later get its own key, set at cutover.

### 4. Redeploy and check without revealing values

1. Redeploy the latest Preview deployment of `claude/copy-center-real-accounts-1jsir9`. Environment changes only apply to new deployments.
2. Wait for the deployment to be **READY**.
3. In the Vercel variable list, check that these names exist for Preview + that branch:
   - `SUPABASE_URL`, the anon/publishable key name, and `COPY_CENTER_OWNER_USER_ID`, all copied from the dedicated branch;
   - `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTION_SECRETS_KEY`.
4. Confirm Production variables are unchanged.
5. Optional, only if the owner is signed in on that preview: in Copy Center → Accounts, the Bitget, BTCC and MT5 panels should no longer say "Saved connections are not configured". Errors about missing tables are expected until the migration is applied. Do not enter any exchange credentials.

## Report back (names and states only)

Send the owner a short report containing:
- the variable **names** added or copied, with scope "Preview · claude/copy-center-real-accounts-1jsir9";
- the deployment ID and its READY state;
- confirmation that Production is unchanged and no values were displayed or stored elsewhere;
- anything that did not match these instructions.

The owner then tells the coding agent, which applies migration `20261110_gem_copy_connection_secrets.sql` to `gem-copy-center` and verifies it.
