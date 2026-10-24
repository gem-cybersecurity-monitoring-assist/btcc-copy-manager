# GEM Copy Center cloud account setup

## Provisioned infrastructure
- Supabase project: `pxcahgcoeewvkhsdvylu` (existing project, not a new paid project).
- Workspace table: `public.copy_center_workspaces`, with row-level security and per-user ownership.
- Vercel environment variables: `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured for Production, Preview, and Development.
- Production deployment: `https://btcc-copy-manager.vercel.app`.

## Included
- Email/password registration and sign-in through Supabase Auth.
- Access and refresh tokens held in HttpOnly, SameSite=Lax cookies (Secure in production).
- Per-user cloud workspace in Supabase Postgres protected by row-level security.
- Server routes for session status, workspace read/write, and sign-out.
- Explicit upload/download controls; no silent overwrites.

## Auth configuration and first-run verification
1. In Supabase Authentication settings, check the Site URL and redirect URL allow-list for the production dashboard domain.
2. Decide whether email confirmation should be required. If it is enabled, a newly registered user must confirm the email before sign-in.
3. Open the dashboard's Cloud Account panel and register or sign in with your own email address.
4. Verify the session is authenticated, then use the explicit upload action to back up local records and the download action to restore records on another device.
5. Test signup and sign-in from the deployed site. Do not use fake credentials or real exchange credentials for this test.

## API routes
- POST `/api/auth/signup` — register.
- POST `/api/auth/login` — sign in.
- POST `/api/auth/logout` — clear cookies.
- GET `/api/auth/session` — configuration and session status.
- GET `/api/workspace` — fetch the signed-in user's workspace.
- PUT `/api/workspace` — save the signed-in user's workspace.

## Security and limitations
- Passwords are handled by Supabase Auth and are not stored by this application.
- The service-role key is never used. Database requests use the signed-in user's JWT and rely on row-level security matching `auth.uid()` to `user_id`.
- Anonymous access is revoked. Authenticated users have only SELECT, INSERT, and UPDATE grants and can act only on their own row.
- Workspace writes have a 750 KB body cap and record-count limits.
- Cloud sync is manual to avoid silent destructive merges. Download replaces local records only after the user confirms.
- Exchange credentials, wallet secrets, orders, transfers, and copy-trade enrollment are not handled by these routes.
- End-to-end signup and sync still require a real user-driven browser test; infrastructure readiness alone does not prove that flow.
