# BTCC Sentinel — Steel on Vercel

This is the low-credit migration path away from Base44's builder. The production control plane lives in this GitHub repository and deploys through the existing `btcc-copy-manager` Vercel project.

## Why this path

Base44's external sandbox bridge requires a paid Builder plan, so the current Base44 source cannot be pulled directly through the connected coding tools on the free tier. Instead of spending more Base44 builder credits, the remaining cloud-browser behavior is implemented in the existing Next.js/Vercel application.

The Base44 app can stay online as a historical fallback, but it is no longer required for the Steel browser flow.

## Required Vercel environment variables

Add these values only in Vercel's encrypted Environment Variables UI. Never commit values to GitHub.

- `STEEL_API_KEY` — Steel project API key. Server-side only.
- `STEEL_CONTROL_SECRET` — a private passphrase of at least 16 characters used to unlock `/steel` on your iPhone.
- `STEEL_STATE_SECRET` — optional separate secret for the encrypted HttpOnly browser-state cookie. If omitted, `STEEL_CONTROL_SECRET` is used as the key source.

The existing BTCC futures API variables are independent from this browser flow. The Steel controller deliberately does not read or accept a BTCC password.

After adding or changing Steel environment variables, create a fresh Production deployment so the new deployment receives the updated environment snapshot. The `/api/v1/steel/auth` endpoint is the safe readiness check: it reports only whether configuration is present and never returns secret values.

## Production flow

1. Open `/steel` on the deployed Vercel site.
2. Unlock with `STEEL_CONTROL_SECRET`.
3. Tap **Start BTCC browser**.
4. The server creates a Steel session with a 30-minute hard timeout, CAPTCHA solving enabled, no inactivity timeout, mobile device mode, and profile persistence.
5. Tap **Open interactive Live View** and complete BTCC sign-in inside Steel.
6. If iPhone input is awkward, use the screenshot/tap fallback and transient OTP field on `/steel`. The fallback intentionally has no password field.
7. Once BTCC shows a signed-in page, tap **Verify login, save profile & close**. The server verifies the browser is no longer on BTCC's login path, releases the Steel session, and retains only an encrypted profile/session reference in an HttpOnly cookie.
8. On the next run, expired sessions are recreated automatically from the saved Steel profile when the user requests a browser action.

## Credit conservation

The page does not create a Steel session simply because it is opened. A session starts only when the user requests one or uses a browser action. Sessions are explicitly released after login verification or when the user taps Release. Monitoring that can use BTCC's documented API should continue to use the API rather than keeping a browser running.

## Security boundaries

- Steel API keys, CDP WebSocket URLs, cookies, and BTCC passwords are never returned by the controller APIs.
- The Steel `debugUrl` is returned only to an authenticated controller session because it is itself an unauthenticated live-session capability URL.
- The browser-state cookie is HttpOnly, SameSite=Strict, Secure in production, authenticated, and encrypted with AES-256-GCM.
- Cross-origin state-changing requests are blocked.
- OTP input is accepted only as 4–8 digits, inserted into the focused browser field, and never stored or echoed in API responses.
- There is no withdrawal or account-security automation in this browser controller.

## Base44 status

Do not spend additional Base44 builder credits for this migration. The direct Base44 file/shell bridge is unavailable on the current plan, so production development should continue in GitHub and Vercel unless the workspace is intentionally upgraded later.
