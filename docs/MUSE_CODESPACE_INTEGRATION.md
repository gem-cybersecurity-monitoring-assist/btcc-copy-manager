# GEM Muse Bridge — Codespace integration

The GEM Muse MCP Bridge is a separate Vercel service at
`https://gem-muse-mcp-bridge.vercel.app/mcp`.

This repository supplies a **read-only** CLI health check for ChatGPT, Muse and
maintainers working in the existing `codespaces-c39052` Codespace. The check
never executes trades, writes a repository, approves a change or modifies Vercel.

## Run

```sh
pnpm muse:check
```

Without `MCP_BEARER_TOKEN`, it checks the live public endpoint and verifies that
anonymous MCP tool discovery is rejected. Authenticated tool discovery and
private GitHub access are reported as **not attempted**, not successes.

For an authorized local terminal whose `MCP_BEARER_TOKEN` is already provisioned
securely, the same command additionally invokes the MCP status tool and
`muse_get_repo_snapshot` to verify a **private** repository read. It never
prints the bearer token or its value. Do **not** paste the token into chat,
commit it, or put it into a shell command/history. A missing bearer is not a
reason to copy the production credential into the Codespace.

The production bridge may internally read Vercel's sensitive
`ADMIN_API_TOKEN` as the GitHub service credential. GitHub Codespaces'
`ADMIN_TOKEN` is a different name in a different secret store and is not
automatically available to Vercel. Only a live authenticated snapshot test
can confirm that the Vercel value is a valid GitHub token.

## Current boundaries

- `muse_prepare_task` prepares, **does not execute**.
- A proposal requires separate owner approval; any approved repository write
  goes to a new review branch, not directly to `main`.
- Never let an agent approve its own changes; never copy approval credentials
  to Muse.
- Public `GET /mcp` and tests with mock data do not prove authenticated
  GitHub access or actual pull-request creation.
- Do not claim autonomous deployments, live exchange connectivity, durable
  financial reconciliation or always-on Codespace uptime from these checks.
- Preserve existing worktrees and original uncommitted changes before
  rebases, merges or branch deletion.

## Reconciliation checkpoint — November 7, 2026

- Existing `/workspaces/btcc-copy-manager` main was 30 commits behind the
  local `origin/main` and had owner edits; do not fast-forward over them.
- `/workspaces/btcc-copy-manager-ui` has uncommitted Sentinel changes; preserve.
- `/workspaces/btcc-copy-manager-ledger-fix` was clean at `30aed5e`.
- This integration uses its own worktree:
  `/workspaces/btcc-copy-manager-muse-integration`.
- No Supabase migration or live financial operation is part of this branch.

For continuing full Copy Manager delivery, refer to
`docs/CHATGPT_WORKSPACE_HANDOFF.md` and
`docs/SENTINEL_OWNER_LEDGER.md`; keep environment selection and approval
requirements unchanged.
