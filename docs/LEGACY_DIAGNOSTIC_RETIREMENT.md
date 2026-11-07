# Retired BTCC / Steel internal HTTP diagnostics

The historical `src/app/api/v1/internal/*/route.ts` handlers were removed in November 2026. They were reachable over the public internet and some could launch billable browser sessions or enter configured exchange credentials without any verified owner authorization. Their public HTTP exposure is not acceptable for a customer-facing trading platform.

The source remains in Git history for audit and offline investigation, not in the production route manifest. Do not restore the URLs as unprotected GET routes, even with unpredictable path names. If diagnostic capability is necessary, implement it as a separate authenticated, owner-scoped operation with explicit user initiation, origin/CSRF safeguards, cost limits, sanitized outputs, and logging. Do not make operations that use login credentials or billable services happen on a GET request.

`tests/internal-routes-retired.test.ts` prevents accidental reintroduction. This change does not enable exchange execution or claim that the older diagnostic behavior was successful.
