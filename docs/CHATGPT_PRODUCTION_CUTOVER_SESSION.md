# ChatGPT work session: production prerequisites for the gem-copy-center cutover

Paste this whole document into a ChatGPT agent session that has a browser and is signed in to Supabase (organization **support371**) and Vercel (team `admin-25521151s-projects`). It is self-contained.

**Run it only after the owner says both gates are met:** the PR #93 preview has been accepted, and PR #93 has been merged.

---

## Your task

Prepare Production for the database switch. Do exactly three things, then report back:

1. In Supabase project **gem-copy-center** (`najhqvsxwbpvadoueced`), allow the production site's sign-in links.
2. In Vercel, add `SUPABASE_SERVICE_ROLE_KEY` for **Production only**.
3. In Vercel, add a **new** `CONNECTION_SECRETS_KEY` for **Production only**.

**Do not redeploy anything.** The coding agent switches the database address and redeploys afterwards.

## Rules

- **Never reveal a secret.** Do not print, type into chat, summarise, screenshot or save a key value. Do not reveal a key after saving it.
- **Never use a `NEXT_PUBLIC_` name** for these variables.
- **Do not edit or delete existing Vercel variables.** In particular, leave `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `COPY_CENTER_OWNER_USER_ID` alone; the coding agent handles those.
- **Do not touch:**
  - the old Supabase project `pxcahgcoeewvkhsdvylu`;
  - existing Supabase keys (do not create, rotate or revoke any);
  - existing Auth URLs;
  - any exchange, trading, payment, deposit or withdrawal setting.
- **Do not reuse the Preview encryption key.** Production gets a newly generated one.
- **Stop and report instead of improvising** if anything differs from this document or asks for payment.

## Step 1: Supabase Auth URLs (gem-copy-center)

1. Go to https://supabase.com/dashboard → organization **support371** → project **gem-copy-center**. The URL must contain `najhqvsxwbpvadoueced`. If it doesn't, stop.
2. Open **Authentication → URL Configuration**.
3. Set **Site URL** to `https://btcc-copy-manager.vercel.app`. Before saving, note the current Site URL in your report. Change nothing else on this page.
4. Under **Redirect URLs**, **add** these two entries. Keep every existing entry, including the preview ones.
   - `https://btcc-copy-manager.vercel.app/copy-center`
   - `https://btcc-copy-manager.vercel.app/reset-password`
5. Save.

## Step 2: Production `SUPABASE_SERVICE_ROLE_KEY`

1. In the same Supabase project, go to **Project Settings → API Keys** and copy the **secret** key with the copy button. Use `sb_secret_…` if it exists; otherwise use the legacy `service_role` key. Never use the publishable/anon key here.
2. Go to Vercel → **btcc-copy-manager** → **Settings → Environment Variables** → **Add**, and fill in:
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** paste the key
   - **Environments:** **Production only**. Untick Preview and Development.
   - **Sensitive:** on
3. Click **Save**.
4. A Preview-scoped `SUPABASE_SERVICE_ROLE_KEY` already exists for one branch. Leave it alone.

## Step 3: New Production `CONNECTION_SECRETS_KEY`

1. Open the browser developer console (F12 → **Console**) and run:
   ```js
   copy(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
   ```
   This copies a new random key to the clipboard without displaying it. If `copy` is unavailable, stop and ask the owner to run `openssl rand -base64 32` on their own computer and paste the output into Vercel themselves.
2. In Vercel, go to **Environment Variables** → **Add** and fill in:
   - **Key:** `CONNECTION_SECRETS_KEY`
   - **Value:** paste from the clipboard
   - **Environments:** **Production only**
   - **Sensitive:** on
3. Click **Save**, then clear the clipboard by copying some harmless text.
4. Do **not** add `CONNECTION_SECRETS_KEY_VERSION`.

## Report back (no secret values)

```
Supabase gem-copy-center (najhqvsxwbpvadoueced):
  Previous Site URL: <value>
  Site URL now: https://btcc-copy-manager.vercel.app — yes/no
  Redirect URLs added: /copy-center yes/no, /reset-password yes/no (existing kept: yes/no)
Vercel Production-only:
  SUPABASE_SERVICE_ROLE_KEY added (Sensitive): yes/no
  CONNECTION_SECRETS_KEY added (Sensitive, new value): yes/no
Existing variables edited or deleted: no
Redeploy performed: no
Secret values displayed or stored anywhere else: no
Anything unexpected: <none / details>
```

The owner gives this report to the coding agent, which completes steps B–E of `PRODUCTION_CUTOVER_RUNBOOK.md`.
