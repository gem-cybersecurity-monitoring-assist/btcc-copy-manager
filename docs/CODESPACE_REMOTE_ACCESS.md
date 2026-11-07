# Reusable Codespace access

Use the existing orange-waddle Codespace. Do not create a new Codespace.

The authenticated Desktop Commander device is the primary command path for ChatGPT.
VS Code chat and the integrated terminal remain available as fallback interfaces.
This setup does not enable exchange credentials, trading, money movement or public ports.

## Startup
The devcontainer post-start hook runs scripts/ensure-codespace-remote.sh.
It reuses Desktop Commander's saved user authentication, refuses duplicate agents,
and leaves first pairing to the owner. The agent version is pinned to 0.3.1.
Logs and process metadata are user-private under ~/.local/state/gem-copy-center-remote.
Authentication stays in Desktop Commander's private home-directory configuration;
never commit, print, upload or copy that file into the repository.

After a Codespace stop/start, check that the existing device is Online and run pwd.
If the hook has not been applied to this existing container yet, run
bash scripts/ensure-codespace-remote.sh from the integrated terminal.
The current container can also use the installed bash profile startup hook.

VS Code workspace trust belongs to each browser profile. This setup does not disable
trust protections; direct authenticated remote access avoids depending on browser trust
for routine commands. A fresh browser/profile may still ask for workspace trust.
A stopped Codespace has no running agent. No 24/7 uptime or free compute is implied.
Home-directory authentication normally survives stop/start; container rebuild or deletion
may require pairing again. Do not claim rebuild recovery without testing it.

## Diagnostics
bash scripts/ensure-codespace-remote.sh --status checks process presence only.
Online status plus a successful remote command establishes actual connectivity.
Do not dump agent logs: pairing links and authentication diagnostics can be sensitive.
The owner can revoke the device from Desktop Commander to end its access.

## Verified November 7, 2026
- Device codespaces-c39052 authenticated and accepted remote shell commands.
- A controlled agent-process restart reused the saved session and returned Online
  with the same device ID. A remote pwd/node/status check succeeded afterward.
- An existing-container user bash-profile hook invokes the same duplicate-safe helper.
- The devcontainer post-start hook is prepared in this branch; this existing container
  has not been rebuilt to apply it. Full Codespace stop/start and rebuild recovery
  remain untested. The current helper lives in the preserved acceptance worktree.
- Version-pinned startup reuses the downloaded package when available.

Do not claim this prevents every browser trust prompt. The verified improvement is
direct saved-session remote access while the existing Codespace is running.
