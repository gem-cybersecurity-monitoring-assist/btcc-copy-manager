# ★ Agent — setup and safety

The **★ Agent** tab is a chat assistant (Claude, model `claude-opus-5-5`) that can do the dashboard's jobs for you in plain language:

| It can (immediately) | It can (only after you click **Approve**) | It cannot |
| --- | --- | --- |
| Summarize your workspace, providers, traders and alerts | Add a trader / strategy (with CSV history) | Move money, deposit, withdraw or trade |
| Explain a trader's score, data quality and eligibility | Change plan settings (capital, reserve, per-provider cap, method) | Start or stop copy trading on any exchange |
| Propose an allocation (real data only, unless you ask for a simulated practice run) | Change risk limits (leverage, drawdown, concentration, minimum score) | Sign in to, read, or change your exchange accounts |
| Report portfolio risk | Record a provider status or figures you confirmed on the platform (status rules still apply: no skipping steps) | Use or ask for passwords, API secrets, seed phrases, or private keys |
| Run a walk-forward backtest | Run a risk review (raises alerts, writes the audit trail) | Mark anything "verified" — your updates are recorded as *confirmed by you* |

Every approved change is saved in this browser like any manual change and written to the audit trail as **agent change approved**. Rejecting a change leaves everything as it was.

## Switch it on (site owner, ~3 minutes)

1. Create an API key at <https://console.anthropic.com> → **API keys** (use a dedicated key for this site; set a monthly spend limit under **Billing → Limits**).
2. In Vercel → project **btcc-copy-manager** → **Settings → Environment Variables**, add
   `ANTHROPIC_API_KEY` = *(your key)* for **Production** and **Preview**. Mark it **Sensitive**. Do **not** prefix it with `NEXT_PUBLIC_`.
3. Redeploy (Deployments → ⋯ → Redeploy) so the new variable is picked up.
4. Open `/copy-trading`, **sign in** with your cloud account (the agent only answers signed-in users so strangers can't spend your credits), then open **★ Agent**.

Never paste the key into chat, a GitHub issue, or the code. To revoke it, delete it in the Anthropic console; the tab then shows "not switched on" / an error and the rest of the app keeps working.

## How it works

- The browser keeps the conversation and sends it to `POST /api/agent`. The server checks same-origin + JSON, rate-limits (40 requests / 10 min per client), requires a valid Supabase session, validates the transcript (no `system` role, only text/tool blocks, ≤ 60 messages, ≤ 400 KB) and adds its own fixed system prompt and tool list before calling the Claude API.
- The agent's tool calls run **in your browser** against your workspace (code in `lib/agent/tools.ts`). Read tools run immediately; write tools build a proposed new workspace, validate it with the same rules as manual edits, and show you a plain-English summary. Nothing is saved until you approve.
- What is sent to Anthropic: your messages and the workspace details the agent looks up (trader names, figures, plan and risk settings, alerts). No cookies, tokens, or cloud credentials are sent. See Anthropic's commercial terms for data handling.
- Server-side fallback is enabled (`fallbacks: "default"`), so if the primary model declines or is unavailable the API may answer with a fallback model.
- The server never logs messages, keys, or tokens; error responses are fixed, safe messages.

## Cost

Usage is billed to the key owner's Anthropic account per token. A typical question costs a few cents; a long multi-step conversation more. Use **New conversation** to start fresh (shorter history = cheaper), and set a spend limit in the Anthropic console.

## Not included yet (later stages)

- Background/scheduled runs and phone push notifications (needs a server-side scheduler and the migration in CLOUD_SETUP.md applied).
- Reading exchange data automatically: no provider in the registry offers a verified read-only integration yet, so the agent works from what you record.
