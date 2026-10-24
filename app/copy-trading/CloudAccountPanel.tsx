"use client";
import { useEffect, useState } from "react";

type Status = { configured?: boolean; authenticated?: boolean; user?: { email?: string } | null; error?: string };
export default function CloudAccountPanel() {
  const [status, setStatus] = useState<Status>({});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refreshStatus() {
    try { const response = await fetch("/api/auth/session", { cache: "no-store" }); setStatus(await response.json()); }
    catch { setStatus({ configured: false, authenticated: false, error: "Could not check cloud account status." }); }
  }
  useEffect(() => { void refreshStatus(); }, []);
  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      if (data.needsEmailConfirmation) { setMessage(data.message || "Check your email to confirm your account."); return; }
      setMessage(mode === "signup" ? "Account created and signed in." : "Signed in.");
      setPassword("");
      await refreshStatus();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Authentication failed."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); setStatus((s) => ({ ...s, authenticated: false, user: null })); setMessage("Signed out."); }
    finally { setBusy(false); }
  }
  function localWorkspace() {
    const parse = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
    return { traders: parse("gem-copy-center-traders-v1"), savedReviews: parse("gem-copy-center-saved-v1"), portfolioSnapshots: parse("gem-copy-center-snapshots-v1") };
  }
  async function upload() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: localWorkspace() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setMessage("Local records saved to your private cloud workspace.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!window.confirm("Download the cloud copy and replace the records currently saved in this browser? Export a backup first if you want to keep both.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Download failed.");
      if (!data.workspace) { setMessage("No cloud workspace exists yet. Upload local records first."); return; }
      const w = data.workspace;
      if (!Array.isArray(w.traders) || !Array.isArray(w.savedReviews) || !Array.isArray(w.portfolioSnapshots)) throw new Error("Cloud workspace format is invalid; local records were not changed.");
      localStorage.setItem("gem-copy-center-traders-v1", JSON.stringify(w.traders));
      localStorage.setItem("gem-copy-center-saved-v1", JSON.stringify(w.savedReviews));
      localStorage.setItem("gem-copy-center-snapshots-v1", JSON.stringify(w.portfolioSnapshots));
      setMessage("Cloud records restored. Reloading the dashboard…");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Download failed."); }
    finally { setBusy(false); }
  }
  return <section className="cloud-account" aria-label="Cloud account and sync">
    <div className="cloud-account-heading"><div><p className="eyebrow">SECURE WORKSPACE</p><h2>Cloud account &amp; sync</h2><p className="muted">Your exchange logins stay on the exchanges. This account stores only the trader notes, bookmarks, and manual portfolio snapshots you choose to sync.</p></div><span className={status.configured ? "cloud-status configured" : "cloud-status"}>{status.configured ? status.authenticated ? "Signed in" : "Cloud ready" : "Setup required"}</span></div>
    {!status.configured ? <div className="cloud-setup-hint"><strong>Cloud setup is not finished.</strong> Add the Supabase project URL and publishable/anon key to Vercel, then run the SQL migration included in the repository. See CLOUD_SETUP.md. Your browser-local records still work.</div> :
      status.authenticated ? <div className="cloud-sync-controls"><p>Signed in as <strong>{status.user?.email || "your account"}</strong></p><div className="cloud-buttons"><button type="button" disabled={busy} onClick={() => void upload()} className="primary-btn">Upload local records</button><button type="button" disabled={busy} onClick={() => void download()} className="secondary-btn">Download cloud records</button><button type="button" disabled={busy} onClick={() => void signOut()} className="secondary-btn">Sign out</button></div></div> :
      <form className="cloud-auth-form" onSubmit={submitAuth}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password (minimum 12 characters for sign-up)<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 12 : 1} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} /></label><div className="cloud-buttons"><button type="submit" className="primary-btn" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}>{mode === "signup" ? "I already have an account" : "Create an account"}</button></div></form>}
    {message && <p className="form-message" role="status">{message}</p>}
    <p className="cloud-footnote">Cloud upload/download is manual. Download replaces this browser's records only after confirmation. Never use exchange passwords, API secrets, wallet recovery phrases, or private keys here.</p>
  </section>;
}
