export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BTCC_LOGIN_URL =
  "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";

function html(body: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>BTCC Sentinel Login</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #07111f; color: #f8fafc; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(92vw, 560px); padding: 28px; border: 1px solid #334155; border-radius: 20px; background: #0f172a; box-sizing: border-box; }
    h1 { margin-top: 0; font-size: 26px; }
    p { color: #cbd5e1; line-height: 1.5; }
    button, a.button { width: 100%; box-sizing: border-box; display: block; text-align: center; padding: 16px 18px; border-radius: 12px; border: 0; background: #f8fafc; color: #0f172a; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
    code { display: block; overflow-wrap: anywhere; padding: 12px; border-radius: 10px; background: #020617; color: #e2e8f0; }
    .warn { color: #fbbf24; }
    .error { color: #fca5a5; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class CdpBrowser {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor(url: string) {
    this.ws = new WebSocket(url);
  }

  async open() {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out connecting to Browserbase CDP.")),
        10_000,
      );
      this.ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Could not connect to Browserbase CDP."));
        },
        { once: true },
      );
    });

    this.ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || "CDP command failed."));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = ++this.seq;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, 12_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async navigate(url: string) {
    const targets = (await this.send("Target.getTargets")) as {
      targetInfos?: Array<{ targetId: string; type: string }>;
    };
    let targetId = targets.targetInfos?.find((target) => target.type === "page")?.targetId;
    if (!targetId) {
      const created = (await this.send("Target.createTarget", { url: "about:blank" })) as {
        targetId?: string;
      };
      targetId = created.targetId;
    }
    if (!targetId) throw new Error("Browserbase did not provide a page target.");

    const attached = (await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    if (!attached.sessionId) throw new Error("Could not attach to Browserbase page target.");

    await this.send("Page.enable", {}, attached.sessionId);
    await this.send("Page.navigate", { url, transitionType: "typed" }, attached.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Best-effort cleanup only. Browserbase keepAlive preserves the session.
    }
  }
}

export async function GET() {
  return html(`
    <h1>BTCC Sentinel cloud login</h1>
    <p>This creates a temporary Browserbase session with a persistent Context, opens the official BTCC login page, and then gives you a Live View link.</p>
    <p class="warn">You enter your BTCC password and 2FA only inside the Browserbase Live View. This app does not receive them.</p>
    <form method="post">
      <button type="submit">Create BTCC cloud session</button>
    </form>
  `);
}

export async function POST() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return html(`<h1>Configuration missing</h1><p class="error">Browserbase is not configured on this Vercel project.</p>`, 503);
  }

  const headers = {
    "Content-Type": "application/json",
    "X-BB-API-Key": apiKey,
  };

  let sessionId: string | undefined;
  let contextId: string | undefined;
  let cdp: CdpBrowser | undefined;

  try {
    const contextResponse = await fetch("https://api.browserbase.com/v1/contexts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId,
        name: `btcc-sentinel-${Date.now()}`,
      }),
      cache: "no-store",
    });
    if (!contextResponse.ok) {
      throw new Error(`Browserbase Context creation failed (${contextResponse.status}).`);
    }
    const context = (await contextResponse.json()) as { id?: string };
    contextId = context.id;
    if (!contextId) throw new Error("Browserbase Context ID was missing.");

    const sessionResponse = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId,
        timeout: 900,
        keepAlive: true,
        browserSettings: {
          context: { id: contextId, persist: true },
          viewport: { width: 390, height: 844 },
        },
        userMetadata: { purpose: "btcc-sentinel-owner-login" },
      }),
      cache: "no-store",
    });
    if (!sessionResponse.ok) {
      const status = sessionResponse.status;
      throw new Error(`Browserbase Session creation failed (${status}).`);
    }
    const session = (await sessionResponse.json()) as {
      id?: string;
      connectUrl?: string;
    };
    sessionId = session.id;
    if (!sessionId || !session.connectUrl) {
      throw new Error("Browserbase Session connection details were missing.");
    }

    cdp = new CdpBrowser(session.connectUrl);
    await cdp.open();
    await cdp.navigate(BTCC_LOGIN_URL);
    cdp.close();
    cdp = undefined;

    const debugResponse = await fetch(
      `https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}/debug`,
      {
        method: "GET",
        headers: { "X-BB-API-Key": apiKey },
        cache: "no-store",
      },
    );
    if (!debugResponse.ok) {
      throw new Error(`Browserbase Live View creation failed (${debugResponse.status}).`);
    }
    const debug = (await debugResponse.json()) as { debuggerFullscreenUrl?: string };
    if (!debug.debuggerFullscreenUrl) {
      throw new Error("Browserbase did not return a Live View URL.");
    }

    return html(`
      <h1>Cloud session ready</h1>
      <p>Tap the button below. The BTCC login page is already open in the cloud browser.</p>
      <a class="button" href="${escapeHtml(debug.debuggerFullscreenUrl)}" rel="noreferrer">Open BTCC Live View</a>
      <p>After you finish BTCC login and any 2FA, leave the session open briefly so Browserbase can persist the Context.</p>
      <p>Context ID:</p>
      <code>${escapeHtml(contextId)}</code>
      <p class="warn">Do not share your password, 2FA code, cookies, or Browserbase session connection URL.</p>
    `);
  } catch (error) {
    cdp?.close();
    const message = error instanceof Error ? error.message : "Unknown bootstrap failure.";
    return html(`
      <h1>Could not create the cloud session</h1>
      <p class="error">${escapeHtml(message)}</p>
      <p>No BTCC credentials were collected. Go back and try once more, or send a screenshot of this error.</p>
    `, 502);
  }
}
