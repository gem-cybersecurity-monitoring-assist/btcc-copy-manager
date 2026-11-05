"use client";
import { useEffect, useState } from "react";
import { readConfirmationRedirect } from "../../../lib/cloud-core.ts";
import { isWorkspaceEmpty, parseWorkspace, workspaceCounts, type Workspace } from "../../../lib/workspace.ts";
import { downloadBackup } from "./storage.ts";

type Status = { loading?: boolean; configured?: boolean; authenticated?: boolean; user?: { email?: string } | null; error?: string };
type Props = { getLocalWorkspace: () => Workspace; onRestore: (workspace: Workspace) => string | null };

async function readJsonResponse(response: Response): Promise<Record<string, any>> {
  try {
    return await response.json();
  } catch {
    return { error: `The server returned an unexpected response (HTTP ${response.status}).` };
  }
}

export default function CloudAccountPanel({ getLocalWorkspace, onRestore }: Props) {
  const [status, setStatus] = useState<Status>({ loading: true });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [offerResend, setOfferResend] = useState(false);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      setStatus(await readJsonResponse(response));
    } catch {
      setStatus({ configured: undefined, authenticated: false, error: "Could not reach the server to check cloud account status. Browser-local records still work." });
    }
  }

  useEffect(() => {
    void refreshStatus();
    // Supabase confirmation links return here with the result in the URL fragment. Tokens in the
    // fragment are not used or stored; the user signs in normally. Strip the fragment from history.
    const outcome = readConfirmationRedirect(window.location.hash);
    if (outcome) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setMode("login");
      if (outcome.kind === "confirmed") setMessage("Email confirmed. Sign in with your email and password to use cloud sync.");
      else { setMessage(outcome.message); setOfferResend(true); }
    }
  }, []);

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setOfferResend(false);
    try {
      const response = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        if (data.code === "email_not_confirmed" || data.code === "user_exists") setOfferResend(true);
        throw new Error(data.error || "Authentication failed.");
      }
      setPassword("");
      if (data.needsEmailConfirmation) {
        setMessage(data.message || "Sign-up request accepted. Check your inbox and spam folder for a confirmation email.");
        setOfferResend(true);
        setMode("login");
        return;
      }
      setMessage(mode === "signup" ? "Account created and signed in." : "Signed in.");
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!email) { setMessage("Enter your email address above, then request a new confirmation email."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await readJsonResponse(response);
      setMessage(response.ok ? data.message : data.error || "Could not request a new confirmation email.");
    } catch {
      setMessage("Could not reach the server. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      setStatus((s) => ({ ...s, authenticated: false, user: null }));
      setMessage("Signed out. Browser-local records were kept.");
    } catch {
      setMessage("Sign-out could not be confirmed by the server. Close the browser or try again.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const local = getLocalWorkspace();
    const warning = isWorkspaceEmpty(local)
      ? "This browser has no records. Uploading will replace your cloud copy with an EMPTY workspace. Continue?"
      : `Upload ${workspaceCounts(local)} from this browser? This replaces the current cloud copy.`;
    if (!window.confirm(warning)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: local }) });
      const data = await readJsonResponse(response);
      if (response.status === 401) await refreshStatus();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setMessage(`Uploaded ${workspaceCounts(local)} to your private cloud workspace${data.updatedAt ? ` at ${new Date(data.updatedAt).toLocaleString()}` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (response.status === 401) await refreshStatus();
      if (!response.ok) throw new Error(data.error || "Download failed.");
      if (!data.workspace) { setMessage("No cloud workspace exists yet. Upload local records first."); return; }
      const parsed = parseWorkspace(data.workspace);
      if (!parsed.ok) throw new Error(`Cloud workspace format is invalid (${parsed.error}). Local records were not changed.`);
      const local = getLocalWorkspace();
      const savedAt = data.updatedAt ? ` (saved ${new Date(data.updatedAt).toLocaleString()})` : "";
      const prompt = isWorkspaceEmpty(local)
        ? `Restore ${workspaceCounts(parsed.value)} from the cloud${savedAt}?`
        : `Replace this browser's ${workspaceCounts(local)} with the cloud copy's ${workspaceCounts(parsed.value)}${savedAt}?\n\nA backup file of the current browser records will be downloaded first.`;
      if (!window.confirm(prompt)) { setMessage("Restore cancelled. Local records were not changed."); return; }
      if (!isWorkspaceEmpty(local)) downloadBackup(local, "-before-cloud-restore");
      const storageError = onRestore(parsed.value);
      setMessage(storageError ?? `Restored ${workspaceCounts(parsed.value)} from your cloud workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  const badge = status.loading ? "Checking…" : status.configured ? (status.authenticated ? "Signed in" : "Cloud ready") : status.configured === false ? "Setup required" : "Status unknown";

  return <section className="cloud-account" aria-label="Cloud account and sync">
    <div className="cloud-account-heading"><div><p className="eyebrow">SECURE WORKSPACE</p><h2>Cloud account &amp; sync</h2><p className="muted">Your exchange logins stay on the exchanges. This account stores only the trader notes, bookmarks, and manual portfolio snapshots you choose to upload.</p></div><span className={status.configured ? "cloud-status configured" : "cloud-status"}>{badge}</span></div>
    {status.error && <p className="cloud-setup-hint" role="alert">{status.error}</p>}
    {status.loading ? null : status.configured === false ? <div className="cloud-setup-hint"><strong>Cloud setup is not finished.</strong> Add the Supabase project URL and publishable/anon key to the deployment environment, then apply the SQL migrations in <code>supabase/migrations</code>. See CLOUD_SETUP.md. Your browser-local records still work.</div> :
      status.authenticated ? <div className="cloud-sync-controls"><p>Signed in as <strong>{status.user?.email || "your account"}</strong></p><div className="cloud-buttons"><button type="button" disabled={busy} onClick={() => void upload()} className="primary-btn">Upload local records</button><button type="button" disabled={busy} onClick={() => void download()} className="secondary-btn">Restore from cloud</button><button type="button" disabled={busy} onClick={() => void signOut()} className="secondary-btn">Sign out</button></div></div> :
      status.configured ? <form className="cloud-auth-form" onSubmit={submitAuth}>
        <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password{mode === "signup" ? " (12–256 characters)" : ""}<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 12 : 1} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div className="cloud-buttons">
          <button type="submit" className="primary-btn" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</button>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); setOfferResend(false); }}>{mode === "signup" ? "I already have an account" : "Create an account"}</button>
          {offerResend && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void resendConfirmation()}>Resend confirmation email</button>}
        </div>
      </form> : null}
    {message && <p className="form-message" role="status" aria-live="polite">{message}</p>}
    <p className="cloud-footnote">Cloud upload and restore are manual. Upload replaces the cloud copy; restore replaces this browser&apos;s records only after confirmation and downloads a backup first. Never use exchange passwords, API secrets, wallet recovery phrases, or private keys here.</p>
  </section>;
}
