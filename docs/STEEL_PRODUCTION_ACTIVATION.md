# Steel production activation

The BTCC Sentinel Steel controller is served by the `btcc-copy-manager` Vercel project.

Required Production environment variables:

- `STEEL_API_KEY`
- `STEEL_CONTROL_SECRET` (minimum 16 characters)

Optional:

- `STEEL_STATE_SECRET` (if omitted, state encryption derives from the control secret)

After changing Vercel environment variables, create a fresh production deployment so the new values are available to the serverless functions.

Verification endpoint:

`/api/v1/steel/auth`

Expected activation state after redeployment:

- `configured: true`
- `missing: []`
- `controlSecretStrongEnough: true`

Do not commit secret values to Git or expose Steel API keys, BTCC passwords, cookies, CDP URLs, or OTP values in logs or client responses.
