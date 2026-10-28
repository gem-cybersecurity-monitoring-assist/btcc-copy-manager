# GEM Copy Center — cloud account setup

## Recorded infrastructure (not independently re-verified in the 2026-10-24 audit)
- Supabase project ref: `pxcahgcoeewvkhsdvylu` (existing project).
- Table `public.copy_center_workspaces` with row-level security (migration `20261024_copy_center_workspaces.sql`).
- Vercel environment variables `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Production, Preview and Development.
- Production: `https://btcc-copy-manager.vercel.app` (Vercel project `btcc-copy-manager`).

Verified on 2026-10-28: production Vercel environment has `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `COPY_CENTER_SITE_URL` configured for Production, Preview, and Development. The Supabase table `public.copy_center_workspaces` exists with RLS enabled, zero rows, and owner-only authenticated SELECT/INSERT/UPDATE policies; table grants show no `anon` access and no DELETE grant. The optional hardening migration `20261025_copy_center_workspace_hardening.sql` is still unapplied: live schema inspection found no payload-size constraint or server-side `updated_at` trigger. The Supabase security advisor also reports leaked-password protection disabled; enabling HaveIBeenPwned protection requires a supported project plan. The production deployment is READY and CI passed 104 tests. A real owner-account save/restore and email-delivery test has not been performed.

Supabase data, Auth settings, SMTP settings and Vercel environment values live in those services, not in this repository.

## 1. Environment variables (Vercel → Settings → Environment Variables)
| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://pxcahgcoeewvkhsdvylu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / publishable key |
| `COPY_CENTER_SITE_URL` (optional, recommended) | `https://btcc-copy-manager.vercel.app` |

Never add the service-role key. Redeploy after changing variables.

## 2. Database migrations (Supabase → SQL Editor, run in order)
1. `supabase/migrations/20261024_copy_center_workspaces.sql` — table, RLS policies, least-privilege grants. (Recorded as applied.)
2. `supabase/migrations/20261025_copy_center_workspace_hardening.sql` — **new, not yet applied.** Adds a database-level 1 MB payload cap, a trigger that sets `updated_at` on the server, and re-asserts grants. Non-destructive and idempotent; the `validate constraint` step fails harmlessly (changing nothing) if an existing row is already over 1 MB.

Verification (read-only):
```sql
select relrowsecurity from pg_class where oid = 'public.copy_center_workspaces'::regclass;  -- true
select policyname, cmd, roles from pg_policies where tablename = 'copy_center_workspaces'; -- SELECT/INSERT/UPDATE for authenticated, auth.uid() = user_id
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'copy_center_workspaces' and grantee in ('anon', 'authenticated');      -- authenticated: SELECT, INSERT, UPDATE only; no anon rows
```

Intelligence-engine data is stored inside the same per-user `payload` (as `payload.engine`) and is validated by the same server route, so no additional migration is required for it.

## 3. Authentication URLs (Supabase → Authentication → URL Configuration)
- **Site URL:** `https://btcc-copy-manager.vercel.app/copy-trading`
- **Redirect URLs (allow-list):** add `https://btcc-copy-manager.vercel.app/copy-trading`. Optionally `http://localhost:3000/copy-trading` for local testing.

The sign-up and resend routes send `redirect_to=<site>/copy-trading`. If that URL is not in the allow-list, Supabase silently falls back to the Site URL; if the Site URL is still the default `http://localhost:3000`, the link in the email will not work from a phone or another computer.

When the user opens the link, the dashboard shows "Email confirmed. Sign in…" (or an "expired link" message) and removes the tokens from the address bar. It never stores tokens from the link; the user signs in normally.

## 4. Email confirmation — diagnosis of "sign-up succeeds but no email arrives"

What the code proves and does not prove:
- A `200` from Supabase `/auth/v1/signup` with `confirmation_sent_at` means Supabase **queued** the email. It does not mean it was delivered. The dashboard now says exactly that.
- If Supabase fails to hand the email to its mail provider, signup returns a `5xx` ("Error sending confirmation email"); the dashboard now reports "no email was delivered" with code `email_send_failed`.
- If the address is already registered, Supabase deliberately returns a look-alike success and **sends no email**. The dashboard uses neutral wording and offers "Resend confirmation email".

Most likely causes, in order (confirm in Supabase → Authentication → Logs, and Project Settings → Authentication → SMTP Settings):
1. **Default Supabase email service is in use.** It only delivers to email addresses of members of the project's Supabase organization and is limited to a few messages per hour. Sign-ups from any other address are accepted but never delivered. → Configure custom SMTP.
2. **Email rate limit reached** (Auth logs show `over_email_send_rate_limit` / 429). The dashboard now shows a specific message. → Wait, or configure SMTP and raise the limit under Authentication → Rate Limits.
3. **Site URL / redirect allow-list** wrong (email arrives but the link fails). → Step 3.
4. **Spam filtering** of the default sender. → Custom SMTP on your own domain with SPF/DKIM/DMARC.

To complete the setup (requires the project owner; may involve a paid email provider and DNS changes — not done automatically):
1. Choose an SMTP provider (e.g. Resend, Postmark, Amazon SES, SendGrid) and verify a sending domain/address with its SPF and DKIM DNS records.
2. Supabase → Project Settings → Authentication → SMTP Settings → enable custom SMTP: host, port (587/465), username, password, sender email and name.
3. Supabase → Authentication → Rate Limits → set "emails sent per hour" to a sensible value.
4. Keep **Confirm email** enabled. Do not disable it to hide delivery problems.
5. Test once with a real inbox you control: sign up → receive email → open link → dashboard shows "Email confirmed" → sign in → upload → restore. Then check Authentication → Logs for the `user_confirmation_requested` and `user_signedup` events.

Leaked-password protection (Authentication → Policies / Password security) depends on the Supabase plan. If it is unavailable on the current plan, record that here; the app enforces a 12-character minimum and surfaces Supabase's "weak/leaked password" rejection when it is enabled.

## 5. Security model
- Passwords go to Supabase Auth only; this app never stores or logs them.
- Access and refresh tokens are kept in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production) and never returned in JSON.
- Database calls carry the user's JWT with the public anon key; RLS (`auth.uid() = user_id`) decides access. The server additionally takes `user_id` from the verified session, never from the request body.
- `anon` has no table privileges; `authenticated` has SELECT/INSERT/UPDATE on its own row only. There is no DELETE grant.
- Mutating routes require same-origin + `application/json` and are rate-limited; payloads are validated (size, counts, every record) on the server.
- Exchange credentials, wallet secrets, orders, transfers and copy-trade enrollment are out of scope for these routes.
