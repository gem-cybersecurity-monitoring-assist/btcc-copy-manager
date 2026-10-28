# ★ Agent — setup and safety

The **★ Agent** tab is a chat assistant that can do the dashboard's jobs for you in plain language. It runs on **Claude** (`claude-opus-5-5`) or **DeepSeek** (`deepseek-chat`) — you choose by which API key you add:

| It can (immediately) | It can (only after you click **Approve**) | It cannot |
| --- | --- | --- |
| Summarize your workspace, providers, traders and alerts | Add a trader / strategy (with CSV history) | Move money, deposit, withdraw or trade |
| Explain a trader's score, data quality and eligibility | Change plan settings (capital, reserve, per-provider cap, method) | Start or stop copy trading on any exchange |
| Propose an allocation (real data only, unless you ask for a simulated practice run) | Change risk limits (leverage, drawdown, concentration, minimum score) | Sign in to, read, or change your exchange accounts |
| Report portfolio risk | Record a provider status or figures you confirmed on the platform (status rules still apply: no skipping steps) | Use or ask for passwords, API secrets, seed phrases, or private keys |
| Run a walk-forward backtest | Run a risk review (raises alerts, writes the audit trail) | Mark anything "verified" — your updates are recorded as *confirmed by you* |

Every approved change is saved in this browser like any manual change and written to the audit trail as **agent change approved**. Rejecting a change leaves everything as it was.

## Switch it on (site owner, ~3 minutes)

Pick **one** provider.

**Option A — DeepSeek (pay-as-you-go, no subscription)**
1. Create an account at <https://platform.deepseek.com>, top up a small balance (e.g. $2), then **API keys → Create new API key**.
2. In Vercel → project **btcc-copy-manager** → **Settings → Environment Variables**, add `DEEPSEEK_API_KEY` = *(your key)* for **Production** and **Preview**, marked **Sensitive**. Do **not** prefix it with `NEXT_PUBLIC_`.
3. Optional: `DEEPSEEK_MODEL` (default `deepseek-chat`, which is the tested model for tool use).

**Option B — Claude (Anthropic)**
1. Create a key at <https://console.anthropic.com> → **API keys** and set a monthly spend limit under **Billing → Limits**.
2. Add `ANTHROPIC_API_KEY` in Vercel the same way.

If both keys are set, Claude is used unless you also set `AGENT_PROVIDER=deepseek`.

Then: **Redeploy** (Deployments → ⋯ → Redeploy), open the site, **sign in** with your cloud account (the agent only answers signed-in users so strangers can't spend your balance), and open **★ Agent**. The footnote under the chat shows which provider is answering.

Never paste a key into chat, a GitHub issue, or the code. To revoke it, delete it in the provider's console; the tab then shows "not switched on" / an error and the rest of the app keeps working.

### Choosing between them
| | DeepSeek (`deepseek-chat`) | Claude (`claude-opus-5-5`) |
| --- | --- | --- |
| Billing | Prepaid balance, very low per-token price | Per-token, higher price; spend limit in console |
| Tool use / approvals | Supported (same tools, same Approve step) | Supported; strict tool schemas; refusal fallback |
| Data location | DeepSeek's servers (China) under DeepSeek's terms | Anthropic's servers under Anthropic's commercial terms |
| If it misbehaves | Ask narrower questions, or switch with `AGENT_PROVIDER` | — |

Either way the safety rules are enforced by the app, not the model: every change still needs **Approve**, inputs are re-validated, status rules can't be skipped, and nothing can move money.

## How it works

- The browser keeps the conversation and sends it to `POST /api/agent`. The server checks same-origin + JSON, rate-limits (40 requests / 10 min per client), requires a valid Supabase session, validates the transcript (no `system` role, only text/tool blocks, ≤ 60 messages, ≤ 400 KB) and adds its own fixed system prompt and tool list before calling the Claude API.
- The agent's tool calls run **in your browser** against your workspace (code in `lib/agent/tools.ts`). Read tools run immediately; write tools build a proposed new workspace, validate it with the same rules as manual edits, and show you a plain-English summary. Nothing is saved until you approve.
- What is sent to the chosen provider (Anthropic or DeepSeek): your messages and the workspace details the agent looks up (trader names, figures, plan and risk settings, alerts). No cookies, tokens, or cloud credentials are sent. Check that provider's terms for data handling; DeepSeek processes data on servers in China.
- Claude only: server-side fallback is enabled (`fallbacks: "default"`), so if the primary model declines or is unavailable the API may answer with a fallback model.
- DeepSeek: the server converts the conversation to DeepSeek's chat-completions format (`lib/agent/deepseek.ts`) and back, so the Agent tab and tools are identical.
- The server never logs messages, keys, or tokens; error responses are fixed, safe messages.

## Cost

Usage is billed per token to the key owner's account at the chosen provider. With DeepSeek a typical question costs a fraction of a cent; with Claude a few cents. Use **New conversation** to start fresh (shorter history = cheaper), and keep a small prepaid balance (DeepSeek) or a spend limit (Anthropic).

## Not included yet (later stages)

- Background/scheduled runs and phone push notifications (needs a server-side scheduler and the migration in CLOUD_SETUP.md applied).
- Reading exchange data automatically: no provider in the registry offers a verified read-only integration yet, so the agent works from what you record.
