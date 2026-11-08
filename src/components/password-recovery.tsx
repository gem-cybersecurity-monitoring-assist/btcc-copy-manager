"use client";
import { useEffect, useRef, useState } from "react";

async function result(response: Response) {
  try { return await response.json(); }
  catch { return { error: "The server returned an unexpected response. Try again shortly." }; }
}

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const started = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(reset);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!reset || started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const bad = params.has("error") || params.has("error_code") || Boolean(window.location.hash);
    // Remove codes/errors before any asynchronous request. Never use implicit-flow tokens.
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        if (bad) throw Error("This recovery link could not be verified. Request a new link in this browser.");
        if (code) {
          const exchange = await fetch("/api/auth/recovery/exchange", {
            method: "POST", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
          });
          const data = await result(exchange);
          if (!exchange.ok) throw Error(data.error || "This recovery link is no longer valid.");
        }
        const response = await fetch("/api/auth/recovery/password", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        const data = await result(response);
        if (!response.ok || data.ready !== true) throw Error(data.error || "Request a new recovery link in this browser, then open the newest email.");
        setReady(true);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery could not be checked."); }
      finally { setBusy(false); }
    })();
  }, [reset]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch(reset ? "/api/auth/recovery/password" : "/api/auth/recovery", {
        method: "POST", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { password, confirmPassword } : { email }),
      });
      const data = await result(response);
      if (!response.ok) throw Error(data.error || "Recovery request failed.");
      setMessage(data.message);
      if (reset) { setPassword(""); setConfirmPassword(""); setReady(false); setDone(true); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not reach the account service."); }
    finally { setBusy(false); }
  }
  return <main className="copy-center-shell"><section className="cloud-account" style={{ maxWidth: 540, margin: "2rem auto", padding: "1rem" }} aria-labelledby="recovery-title">
    <h1 id="recovery-title">{reset ? "Choose a new password" : "Recover your account"}</h1>
    <p>{reset ? "Recovery does not sign you into your financial workspace. After changing your password, sign in normally." : "Enter your GEM Copy Center email. Open the newest recovery link in this same browser within 10 minutes."}</p>
    {(!reset || ready) && <form className="cloud-auth-form" onSubmit={submit}>
      {!reset ? <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label> : <>
        <label>New password (12–256 characters)<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
      </>}
      <button className="primary-btn" disabled={busy} type="submit">{busy ? "Please wait…" : reset ? "Change password" : "Request recovery email"}</button>
    </form>}
    {busy && reset && !ready && <p role="status">Checking recovery link…</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    <div className="cloud-buttons"><a href="/sign-in">Back to sign in</a>{reset && !ready && !busy && !done && <a href="/forgot-password">Request a new link</a>}</div>
    <p className="cloud-footnote">Use your application password here. Never enter exchange passwords, API credentials or wallet recovery phrases.</p>
  </section></main>;
}
