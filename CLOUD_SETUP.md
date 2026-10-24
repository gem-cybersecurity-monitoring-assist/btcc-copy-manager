# GEM Copy Center cloud account setup

## Included
- Email/password registration and sign-in through Supabase Auth.
- Access and refresh tokens held in HttpOnly, SameSite=Lax cookies (Secure in production).
- Per-user cloud workspace in Supabase Postgres protected by row-level security.
- Server routes for session status, workspace read/write, and sign-out.
- Explicit upload/download controls; no silent overwrites.

## Configure once
1. Create or select a Supabase project in your own account. This app does not create paid infrastructure automatically.
2. In Supabase project settings, copy the project URL and publishable/anon key.
3. In the Supabase SQL Editor, run supabase/migrations/20261024_copy_center_workspaces.sql.
4. In Supabase Auth settings, configure allowed site URLs and email confirmation.
5. In Vercel, open project btcc-copy-manager, then Settings and Environment Variables. Add SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for Preview and Production as needed. These are the project URL and publishable/anon key, not a service-role key. Redeploy after saving.
6. Use the Cloud account panel on the dashboard to create an account or sign in, then explicitly choose Upload local records or Download cloud records.

## API routes
- POST /api/auth/signup — register.
- POST /api/auth/login — sign in.
- POST /api/auth/logout — clear cookies.
- GET /api/auth/session — configuration and session status.
- GET /api/workspace — fetch the signed-in user's workspace.
- PUT /api/workspace — save the signed-in user's workspace.

## Security and limitations
- Passwords are handled by Supabase Auth and are not stored by this application.
- The service-role key is never used. Database requests use the signed-in user's JWT and rely on row-level security matching auth.uid() to user_id.
- Workspace writes have a 750 KB body cap and record-count limits.
- Cloud sync is manual to avoid silent destructive merges. Download replaces local records only after the user confirms.
- Exchange credentials, wallet secrets, orders, transfers, and copy-trade enrollment are not handled by these routes.
