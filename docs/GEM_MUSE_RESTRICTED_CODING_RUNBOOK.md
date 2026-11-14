# GEM Muse — restricted coding execution and verification runbook
Verified: 14 November 2026

## Intent and accepted boundaries
Enable ChatGPT-directed development tasks to reach the independent GEM Muse coding workflow while keeping existing production applications, financial operations, account credentials, and billing unchanged. This implementation covers **small, public, fixed-scope code proposals** only. It is not a general autonomous coding agent.

Current repository: `gem-cybersecurity-monitoring-assist/btcc-copy-manager` (**public on GitHub**).
All new proposals are review-only: they stay in draft pull requests and are never automatically merged, deployed, or used for live trading.

## Working routes
1. **Private audit tasks:** ChatGPT submits into the existing separate Neon `gem-muse-private-tasks` database and uses the Vercel `gem-muse-task-worker` read-only queue worker. Verified GitHub audits and task events are saved. Do not insert access tokens into task descriptions.
2. **Restricted public coding tasks:** ChatGPT creates a sanitized `.github/muse-public-tasks/<UUIDv4>.json` on the isolated pilot branch `muse/coding-agent-draft-pr-pilot-20261113`. Exactly one changed file per task commit is required.
3. Workflow `.github/workflows/muse-public-task-runner.yml` performs a public commit-file check through GitHub's authenticated read-only API, validates the request against `scripts/muse-public-task-guard.mjs`, then runs the locally downloaded open-weight Qwen2.5-Coder-0.5B-Instruct Q4_K_M coding model in a GitHub-hosted job with repository **read-only permissions**.
4. Generated model output is **untrusted**. `scripts/muse-model-code-guard.mjs` extracts only the allowed arithmetic helper, verifies behavior and a source SHA-256; all surrounding model text is discarded. This is not a general-purpose sandbox.
5. A separate GitHub job downloads only the validated artifact, revalidates the public request and exact code/hash, and uses scoped `contents:write` to commit a new file only under `scripts/muse-proposals/` on its own generated branch. It does not merge or deploy.
6. The repository's GitHub Actions policy blocks automated PR creation. Preserve that security policy. An explicitly authorized ChatGPT GitHub connector opens the resulting **draft** PR. An owner must review before any merge.

## Verified execution evidence
- Existing draft executor PR: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/95
- Deterministic independent proposal draft: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/96
- First independent AI-generated file draft: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/97
- **ChatGPT-submitted public coding task:** `4d2ea931-b498-4d77-9d9c-e2ce557f6454`
- Independent coding-task workflow: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/actions/runs/43548887591 (both stages **success**)
- Resulting draft PR: https://github.com/gem-cybersecurity-monitoring-assist/btcc-copy-manager/pull/98 (**open, unmerged**)
- Generated file: `scripts/muse-proposals/ai-task-4d2ea931.mjs`
- PR #98 repository CI and production smoke checks **success**, not an application deployment.
- Neon private evidence record: `b863ec28-bd31-4ab0-a31f-d1fc347a59a3` (external model workflow recorded as evidence; it does **not** mean the original Neon worker performs code generation).

## Costs and credentials
- GitHub standard-hosted runners for **public** repositories are free; this accepted test used that route, not paid Vercel inference or a paid Copilot session.
- CPU model runtime archive is pinned to llama.cpp release `b12248` with SHA-256 `6b3a530b44f6b0a4ae4872d3b3c8d1edc2ac6bba7d8bd211329a4ba644c0dc65`.
- Public Qwen2.5-Coder-0.5B-Instruct model is fetched from Hugging Face. Treat its weights as untrusted third-party input; the present workflow pins its runtime but not the HF repository revision.
- No production secret or trading credential is passed to model inference. The publisher has only the GitHub Actions scoped token and runs after independent verification.
- No automatic withdrawal, order placement, merger, billing upgrade, or deployment is authorized.

## Still not accepted
- Private Neon queue **directly triggering arbitrary AI coding**: not connected; the public task workflow is the independent coding route.
- General-purpose autonomous code modification: not implemented. The model guard allows only a specific arithmetic function and is explicitly not a general code execution sandbox.
- An AI coding model with sufficient verified quality for production changes: not established by a 0.5B proof.
- Native `@GEM Muse` write-capable ChatGPT custom MCP plugin: account/workspace entitlement and owner installation remain prerequisites. The Plus/iPhone chat can use its already connected GitHub and Neon tools instead; it cannot provision a privileged native custom MCP plugin itself.
- Owner OAuth consent and end-to-end protected MCP write call: not verified.
- Vercel status page deployment update: blocked on 14 November by daily free-tier API deployment limit (HTTP 402 `api-deployments-free-per-day`); preserve existing live worker and tracker until permitted retry. No upgrade authorized.

## Future tasks
For a **public fixed-scope** addition-helper task, validate the JSON against `validateMusePublicTask`, ensure no sensitive material, create a new UUIDv4 file under `.github/muse-public-tasks/` on the isolated pilot branch, verify the triggered Actions run completed successfully, inspect the exact generated file and CI results, and create only a draft PR. Record GitHub evidence in the Neon task ledger with unambiguous provenance.

For private or broader tasks, keep instructions only in the protected queue and return a precise blocked status instead of exposing private code in public GitHub or bypassing the approval path.

Never claim native MCP installation, private unattended coding, secure execution of arbitrary generated code, or production readiness from these restricted pilot tests.
