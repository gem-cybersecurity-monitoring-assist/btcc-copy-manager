"use client";

import { FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";

type AuthStatus = {
  configured: boolean;
  authorized: boolean;
  missing: string[];
  controlSecretStrongEnough: boolean;
};

type SessionStatus = {
  ok?: boolean;
  sessionLive?: boolean;
  profileAvailable?: boolean;
  startedAt?: string | null;
  timeoutMs?: number | null;
  remainingMs?: number;
  viewerUrl?: string;
  recreated?: boolean;
  profilePersisting?: boolean;
  message?: string;
  error?: string;
};

const card: React.CSSProperties = {
  background: "rgba(15,23,42,.92)",
  border: "1px solid #263449",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 18px 60px rgba(0,0,0,.24)",
};

const button: React.CSSProperties = {
  appearance: "none",
  border: 0,
  borderRadius: 12,
  padding: "13px 15px",
  fontWeight: 800,
  cursor: "pointer",
  background: "#f8fafc",
  color: "#0f172a",
  minHeight: 48,
};

const secondaryButton: React.CSSProperties = {
  ...button,
  background: "#172033",
  color: "#e2e8f0",
  border: "1px solid #334155",
};

const dangerButton: React.CSSProperties = {
  ...button,
  background: "#3f1820",
  color: "#fecdd3",
  border: "1px solid #7f1d1d",
};

function formatRemaining(ms = 0) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function readJson(response: Response) {
  try {
    return await response.json() as SessionStatus & { authorized?: boolean; configured?: boolean; missing?: string[] };
  } catch {
    return { error: `Request failed (${response.status}).` };
  }
}

export default function SteelControlPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [session, setSession] = useState<SessionStatus>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [remainingMs, setRemainingMs] = useState(0);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const loadAuth = useCallback(async () => {
    const response = await fetch("/api/v1/steel/auth", { cache: "no-store" });
    const data = await response.json() as AuthStatus;
    setAuth(data);
    return data;
  }, []);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/v1/steel/session", { cache: "no-store" });
    const data = await readJson(response);
    if (response.ok) {
      setSession(data);
      setRemainingMs(data.remainingMs || 0);
    } else if (response.status === 401) {
      setAuth((current) => current ? { ...current, authorized: false } : current);
    } else {
      setNotice(data.error || "Could not read Steel session status.");
    }
  }, []);

  useEffect(() => {
    void loadAuth().then((status) => {
      if (status.authorized) void loadSession();
    });
  }, [loadAuth, loadSession]);

  useEffect(() => {
    if (!session.sessionLive) return;
    const timer = window.setInterval(() => setRemainingMs((value) => Math.max(0, value - 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [session.sessionLive, session.startedAt]);

  useEffect(() => () => {
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
  }, [screenshotUrl]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/v1/steel/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    setSecret("");
    const data = await readJson(response);
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error || "Authorization failed.");
      return;
    }
    const next = await loadAuth();
    if (next.authorized) await loadSession();
  }

  async function sessionAction(action: "ensure" | "finish" | "release" | "reset-profile" | "home") {
    setBusy(true);
    setNotice("");
    const response = await fetch("/api/v1/steel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await readJson(response);
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error || "Steel session action failed.");
      return;
    }
    setSession((current) => ({ ...current, ...data }));
    if (data.remainingMs !== undefined) setRemainingMs(data.remainingMs || 0);
    if (action === "finish") {
      setSession((current) => ({ ...current, sessionLive: false, viewerUrl: undefined, profileAvailable: true }));
      setNotice(data.message || "Login profile is being persisted.");
      clearScreenshot();
    }
    if (action === "release" || action === "reset-profile") {
      setSession((current) => ({ ...current, sessionLive: false, viewerUrl: undefined, profileAvailable: action === "release" ? current.profileAvailable : false }));
      clearScreenshot();
    }
    if (action === "ensure") {
      setNotice(data.recreated ? "Expired browser was recreated automatically." : "Steel browser is live.");
    }
  }

  function clearScreenshot() {
    setScreenshotUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }

  async function refreshScreenshot() {
    setBusy(true);
    setNotice("");
    const response = await fetch(`/api/v1/steel/screenshot?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      const data = await readJson(response);
      setBusy(false);
      setNotice(data.error || "Screenshot failed.");
      return;
    }
    const blob = await response.blob();
    const next = URL.createObjectURL(blob);
    setScreenshotUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
    setBusy(false);
    if (response.headers.get("x-steel-recreated") === "1") {
      setNotice("The expired Steel browser was recreated before the screenshot.");
      await loadSession();
    }
  }

  async function sendInput(payload: Record<string, unknown>) {
    const response = await fetch("/api/v1/steel/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || "Browser input failed.");
    if (data.recreated) await loadSession();
  }

  async function tapScreenshot(event: MouseEvent<HTMLImageElement>) {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const rect = image.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * image.naturalWidth;
    const y = ((event.clientY - rect.top) / rect.height) * image.naturalHeight;
    setBusy(true);
    setNotice("");
    try {
      await sendInput({ action: "tap", x, y });
      await refreshScreenshot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Tap failed.");
      setBusy(false);
    }
  }

  async function submitOtp(event: FormEvent) {
    event.preventDefault();
    const value = otp.trim();
    setOtp("");
    if (!/^\d{4,8}$/.test(value)) {
      setNotice("OTP must contain 4 to 8 digits.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await sendInput({ action: "otp", value });
      setNotice("OTP was sent to the focused browser field and was not stored or returned.");
      await refreshScreenshot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "OTP entry failed.");
      setBusy(false);
    }
  }

  async function quickInput(action: "reload" | "home") {
    setBusy(true);
    setNotice("");
    try {
      await sendInput({ action });
      await refreshScreenshot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Browser action failed.");
      setBusy(false);
    }
  }

  async function signOutController() {
    await fetch("/api/v1/steel/auth", { method: "DELETE" });
    setAuth((current) => current ? { ...current, authorized: false } : current);
    setSession({});
    clearScreenshot();
  }

  return <main style={{ minHeight: "100vh", background: "radial-gradient(circle at 20% 0%, #172554 0, #07111f 38%, #030712 100%)", color: "#f8fafc", padding: "max(18px, env(safe-area-inset-top)) 14px max(30px, env(safe-area-inset-bottom))", fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
    <div style={{ width: "min(760px, 100%)", margin: "0 auto", display: "grid", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ color: "#93c5fd", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", fontSize: 12 }}>BTCC Sentinel</div>
          <h1 style={{ margin: "6px 0 4px", fontSize: "clamp(26px, 8vw, 40px)" }}>Steel browser control</h1>
          <p style={{ margin: 0, color: "#aebbd0", lineHeight: 1.55 }}>Vercel-hosted control plane. Base44 credits are not used here.</p>
        </div>
        <a href="/" style={{ color: "#dbeafe", textDecoration: "none", border: "1px solid #334155", borderRadius: 999, padding: "9px 12px", whiteSpace: "nowrap" }}>Dashboard</a>
      </header>

      {notice && <div style={{ ...card, background: "#122038", color: "#dbeafe" }}>{notice}</div>}

      {!auth && <section style={card}>Checking secure controller…</section>}

      {auth && !auth.configured && <section style={card}>
        <h2 style={{ marginTop: 0 }}>Two Vercel secrets are still required</h2>
        <p style={{ color: "#b7c4d7", lineHeight: 1.55 }}>Add the missing values in the Vercel project environment, then redeploy. Values are never displayed here.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {auth.missing.map((name) => <code key={name} style={{ background: "#050b16", borderRadius: 10, padding: 12, color: "#fca5a5" }}>{name}</code>)}
          {!auth.controlSecretStrongEnough && !auth.missing.includes("STEEL_CONTROL_SECRET") && <code style={{ background: "#050b16", borderRadius: 10, padding: 12, color: "#fca5a5" }}>STEEL_CONTROL_SECRET must be at least 16 characters</code>}
        </div>
      </section>}

      {auth?.configured && !auth.authorized && <section style={card}>
        <h2 style={{ marginTop: 0 }}>Unlock the browser controller</h2>
        <p style={{ color: "#b7c4d7", lineHeight: 1.55 }}>Enter the Steel controller passphrase you placed in <code>STEEL_CONTROL_SECRET</code>. This is not your BTCC password.</p>
        <form onSubmit={authenticate} style={{ display: "grid", gap: 10 }}>
          <input type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Controller passphrase" style={{ minHeight: 50, borderRadius: 12, border: "1px solid #334155", background: "#050b16", color: "#f8fafc", padding: "0 14px", fontSize: 16 }} />
          <button disabled={busy || secret.length < 1} style={{ ...button, opacity: busy ? .6 : 1 }}>{busy ? "Checking…" : "Unlock"}</button>
        </form>
      </section>}

      {auth?.authorized && <>
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: session.sessionLive ? "#86efac" : "#fbbf24", fontWeight: 900, fontSize: 13, textTransform: "uppercase" }}>{session.sessionLive ? "Session live" : "Session idle"}</div>
              <h2 style={{ margin: "5px 0 3px" }}>{session.sessionLive ? `Time remaining ${formatRemaining(remainingMs)}` : session.profileAvailable ? "Saved BTCC profile available" : "Ready for first BTCC login"}</h2>
              <p style={{ margin: 0, color: "#aebbd0" }}>30-minute hard timeout · no inactivity timeout · CAPTCHA solving enabled · persistent Steel profile.</p>
            </div>
            <button onClick={() => void signOutController()} style={{ ...secondaryButton, minHeight: 42, padding: "9px 12px" }}>Lock</button>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>1. Start or reconnect</h2>
          <p style={{ color: "#b7c4d7", lineHeight: 1.55 }}>This reuses the existing session when it is alive. If it expired, the server automatically creates a new Steel browser using the saved profile instead of failing on the BTCC sign-in page.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 9 }}>
            <button disabled={busy} onClick={() => void sessionAction("ensure")} style={button}>{busy ? "Working…" : session.sessionLive ? "Reconnect / verify" : "Start BTCC browser"}</button>
            {session.sessionLive && session.viewerUrl && <a href={session.viewerUrl} target="_blank" rel="noreferrer" style={{ ...secondaryButton, textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>Open interactive Live View</a>}
            {session.sessionLive && <button disabled={busy} onClick={() => void sessionAction("home")} style={secondaryButton}>Open BTCC assets</button>}
          </div>
          <p style={{ color: "#fbbf24", fontSize: 13, lineHeight: 1.5, marginBottom: 0 }}>Enter your BTCC password only inside Steel's interactive Live View. This controller deliberately has no BTCC password field.</p>
        </section>

        {session.sessionLive && <section style={card}>
          <h2 style={{ marginTop: 0 }}>2. iPhone fallback controller</h2>
          <p style={{ color: "#b7c4d7", lineHeight: 1.55 }}>If the Live View keyboard or touch controls are awkward, refresh the screenshot and tap directly on it. The server maps the tap to the live Steel browser. OTP entry is transient and is never saved, logged, or echoed back.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button disabled={busy} onClick={() => void refreshScreenshot()} style={secondaryButton}>Refresh screenshot</button>
            <button disabled={busy} onClick={() => void quickInput("reload")} style={secondaryButton}>Reload page</button>
            <button disabled={busy} onClick={() => void quickInput("home")} style={secondaryButton}>BTCC assets</button>
          </div>
          {screenshotUrl ? <img ref={imageRef} src={screenshotUrl} alt="Live Steel browser screenshot" onClick={(event) => void tapScreenshot(event)} style={{ width: "100%", borderRadius: 14, display: "block", border: "1px solid #334155", cursor: "crosshair", touchAction: "manipulation" }} /> : <div style={{ border: "1px dashed #475569", borderRadius: 14, padding: 26, textAlign: "center", color: "#94a3b8" }}>Tap “Refresh screenshot” to load the current browser frame.</div>}
          <form onSubmit={submitOtp} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12 }}>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Focused OTP field: 4–8 digits" style={{ minWidth: 0, minHeight: 50, borderRadius: 12, border: "1px solid #334155", background: "#050b16", color: "#f8fafc", padding: "0 13px", fontSize: 16 }} />
            <button disabled={busy || otp.length < 4} style={button}>Send OTP</button>
          </form>
        </section>}

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>3. Persist login and stop spending browser minutes</h2>
          <p style={{ color: "#b7c4d7", lineHeight: 1.55 }}>After BTCC shows the signed-in account area, verify and close the session. The app will only release after the current BTCC URL is no longer the login page, allowing Steel to persist the profile for the next session.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 9 }}>
            <button disabled={busy || !session.sessionLive} onClick={() => void sessionAction("finish")} style={button}>Verify login, save profile & close</button>
            <button disabled={busy || !session.sessionLive} onClick={() => void sessionAction("release")} style={secondaryButton}>Release without verification</button>
            <button disabled={busy} onClick={() => { if (window.confirm("Forget the saved Steel profile reference on this device?")) void sessionAction("reset-profile"); }} style={dangerButton}>Forget saved profile</button>
          </div>
        </section>
      </>}
    </div>
  </main>;
}
