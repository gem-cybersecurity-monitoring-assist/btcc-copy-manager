# GEM Copy Center password recovery

## Implemented boundary

The account pages link to /forgot-password. A same-origin, rate-limited JSON POST requests Supabase password recovery using S256 PKCE. A random 32-byte verifier is held in a 10-minute HttpOnly/Secure/SameSite=Lax cookie; the email contains a one-use authorization code. The newest email must open in the same browser that requested it. New requests replace the prior verifier.

The public /reset-password page removes query/fragment values from browser history before asynchronous work and refuses implicit-flow tokens. Its response uses no-referrer and private/no-store. A guarded POST exchanges the code and verifier with the existing bounded Auth transport. It sets a separate short-lived HttpOnly recovery cookie, never the application access/refresh cookies. Recovery alone cannot access private financial pages. No tokens are returned to JavaScript or stored in localStorage.

Changing the password requires a verified, email-confirmed, nonanonymous Auth user in that recovery context, matching passwords of 12–256 characters, and same-origin JSON. The provider receives only the password field. Success clears app and recovery cookies, attempts global refresh-session revocation and requires normal sign-in. A failed revocation is reported accurately. Previously issued access JWTs may remain usable until expiry; this flow does not claim instantaneous revocation of every JWT.

## Activation and hosted acceptance

Email requests fail closed with recovery_not_configured until COPY_CENTER_PASSWORD_RECOVERY_ENABLED=true is deliberately configured. Leave it unset until these prerequisites pass. No provider secrets or paid service are added.

1. In the dedicated Supabase Auth URL configuration, preserve existing confirmation destinations and add exactly:
   https://btcc-copy-manager-git-feat-dedi-f5ec4c-admin-25521151s-projects.vercel.app/reset-password
2. Verify the deployed preview contains this implementation, COPY_CENTER_SITE_URL (if configured) is that same origin, and the recovery email template uses Supabase ConfirmationURL. Preserve email confirmation requirements. Do not broadly allow wildcard redirect hosts.
3. Enable the flag only for this dedicated Preview branch and deploy. Use the owner's secure browser session to request an actual email, inspect its safe final destination without logging the code, change the password by owner handoff, then sign in and restore the workspace.
4. Verify newest-link, same-browser, expired/replayed-link and invalid-session rejection. Check email limits and actual delivery separately; HTTP success does not prove delivery.
5. Before the approved production database cutover, also allow exactly https://btcc-copy-manager.vercel.app/reset-password in the dedicated Auth project, preserve the required preview/confirmation URLs, and set the dedicated production Site URL appropriately. Enable recovery in production only after the destination and real preview flow pass.

The old production project's Auth settings remain unchanged. The owner must enter and submit any new password directly; never request it in chat. Actual email delivery, hosted recovery, and iPhone Safari behavior remain unverified until performed. Local fixtures do not substitute for them.

## Verification

pnpm check includes the recovery service tests. The existing scripts/qa-owner-auth-fixture.mjs now also supports local synthetic S256 recovery and single-use exchange. scripts/qa-password-recovery.mjs tests the mounted route/UI at 320, 390 and 1440 pixels using only a loopback app URL; it checks code removal, cookie protections, financial-session separation, password submission, replay rejection, CSRF and no-referrer. Run it with GEM_QA_APP_URL and GEM_QA_PLAYWRIGHT_MODULE against the isolated synthetic Auth server, with the recovery flag enabled only on that test app.

Official protocol references:
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/server-side/advanced-guide
- https://github.com/supabase/auth/blob/master/openapi.yaml

This feature does not configure a collector, exchange connection, worker or approval service and does not authorize financial execution.
