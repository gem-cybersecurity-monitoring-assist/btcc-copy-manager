import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEEL_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const BTCC_LOGIN_URL = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";
export const BTCC_ASSETS_URL = "https://www.btcc.com/en-US/user-center/assets";
export const STEEL_AUTH_COOKIE = "btcc_steel_auth";
export const STEEL_STATE_COOKIE = "btcc_steel_state";

const STEEL_API_BASE = "https://api.steel.dev/v1";
const STEEL_CDP_BASE = "wss://connect.steel.dev";

type SteelSessionResponse = {
  id?: string;
  debugUrl?: string;
  sessionViewerUrl?: string;
  profileId?: string;
};

export type SteelBrowserState = {
  sessionId?: string;
  profileId?: string;
  viewerUrl?: string;
  startedAt?: string;
  timeoutMs?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function steelConfigStatus() {
  const missing: string[] = [];
  if (!process.env.STEEL_API_KEY?.trim()) missing.push("STEEL_API_KEY");
  const control = process.env.STEEL_CONTROL_SECRET?.trim();
  if (!control) missing.push("STEEL_CONTROL_SECRET");
  return {
    ready: missing.length === 0 && Boolean(control && control.length >= 16),
    missing,
    controlSecretStrongEnough: Boolean(control && control.length >= 16),
    timeoutMs: STEEL_SESSION_TIMEOUT_MS,
    captchaSolving: false,
    inactivityTimeoutDisabled: true,
    persistentProfiles: true,
  };
}

function steelApiKey() {
  return required("STEEL_API_KEY");
}

function controlSecret() {
  return required("STEEL_CONTROL_SECRET");
}

function stateKey() {
  const source = process.env.STEEL_STATE_SECRET?.trim() || controlSecret();
  return createHash("sha256").update(`btcc-steel-state:v1:${source}`, "utf8").digest();
}

function b64url(value: Buffer) {
  return value.toString("base64url");
}

export function expectedAuthCookie() {
  return createHmac("sha256", controlSecret()).update("btcc-steel-control:v1").digest("base64url");
}

export function verifyControlSecret(candidate: string) {
  const expected = Buffer.from(controlSecret(), "utf8");
  const supplied = Buffer.from(candidate, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function verifyAuthCookie(candidate?: string) {
  if (!candidate) return false;
  const expected = Buffer.from(expectedAuthCookie(), "utf8");
  const supplied = Buffer.from(candidate, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function sealSteelState(state: SteelBrowserState) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(encrypted)}.${b64url(tag)}`;
}

export function unsealSteelState(value?: string): SteelBrowserState {
  if (!value) return {};
  try {
    const [version, ivText, dataText, tagText] = value.split(".");
    if (version !== "v1" || !ivText || !dataText || !tagText) return {};
    const decipher = createDecipheriv("aes-256-gcm", stateKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted) as SteelBrowserState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function steelHeaders() {
  return {
    "content-type": "application/json",
    "steel-api-key": steelApiKey(),
  };
}

export async function createSteelSession(profileId?: string) {
  const body: Record<string, unknown> = {
    timeout: STEEL_SESSION_TIMEOUT_MS,
    solveCaptcha: false,
    blockAds: true,
    persistProfile: true,
    deviceConfig: { device: "mobile" },
  };
  if (profileId) body.profileId = profileId;

  const response = await fetch(`${STEEL_API_BASE}/sessions`, {
    method: "POST",
    headers: steelHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Steel session creation failed (${response.status}).`);
  }
  const data = (await response.json()) as SteelSessionResponse;
  const id = data.id;
  const viewerUrl = data.debugUrl || data.sessionViewerUrl;
  if (!id || !viewerUrl) throw new Error("Steel session response was missing required fields.");

  return {
    sessionId: id,
    profileId: data.profileId || profileId,
    viewerUrl,
    startedAt: new Date().toISOString(),
    timeoutMs: STEEL_SESSION_TIMEOUT_MS,
  } satisfies SteelBrowserState;
}

export async function releaseSteelSession(sessionId: string) {
  try {
    const response = await fetch(`${STEEL_API_BASE}/sessions/${encodeURIComponent(sessionId)}/release`, {
      method: "POST",
      headers: steelHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok || response.status === 404 || response.status === 409) return;
    throw new Error(`Steel session release failed (${response.status}).`);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return;
    throw error;
  }
}

class SteelCdp {
  private readonly ws: WebSocket;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(sessionId: string) {
    const url = `${STEEL_CDP_BASE}?apiKey=${encodeURIComponent(steelApiKey())}&sessionId=${encodeURIComponent(sessionId)}`;
    this.ws = new WebSocket(url);
  }

  async open(timeoutMs = 10_000) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Steel CDP connection timed out.")), timeoutMs);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Steel CDP connection failed."));
      }, { once: true });
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
      if (message.error) pending.reject(new Error(message.error.message || "Steel CDP command failed."));
      else pending.resolve(message.result);
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 12_000) {
    const id = ++this.seq;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Steel CDP ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private async attachPage() {
    const targets = (await this.send("Target.getTargets")) as {
      targetInfos?: Array<{ targetId: string; type: string }>;
    };
    let targetId = targets.targetInfos?.find((target) => target.type === "page")?.targetId;
    if (!targetId) {
      const created = (await this.send("Target.createTarget", { url: "about:blank" })) as { targetId?: string };
      targetId = created.targetId;
    }
    if (!targetId) throw new Error("Steel browser did not expose a page target.");
    const attached = (await this.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId?: string };
    if (!attached.sessionId) throw new Error("Could not attach to the Steel page target.");
    await this.send("Page.enable", {}, attached.sessionId);
    await this.send("Runtime.enable", {}, attached.sessionId);
    return attached.sessionId;
  }

  async navigate(url: string) {
    const pageSession = await this.attachPage();
    await this.send("Page.navigate", { url, transitionType: "typed" }, pageSession);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  async currentUrl() {
    const pageSession = await this.attachPage();
    const result = (await this.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    }, pageSession)) as { result?: { value?: string } };
    return typeof result.result?.value === "string" ? result.result.value : "";
  }

  async screenshot() {
    const pageSession = await this.attachPage();
    const result = (await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, pageSession, 20_000)) as { data?: string };
    if (!result.data) throw new Error("Steel did not return a screenshot.");
    return Buffer.from(result.data, "base64");
  }

  async tap(x: number, y: number) {
    const pageSession = await this.attachPage();
    for (const type of ["mousePressed", "mouseReleased"] as const) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      }, pageSession);
    }
  }

  async insertOtp(value: string) {
    const pageSession = await this.attachPage();
    for (const digit of value) {
      await this.send("Input.insertText", { text: digit }, pageSession);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  async reload() {
    const pageSession = await this.attachPage();
    await this.send("Page.reload", { ignoreCache: true }, pageSession);
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Steel CDP connection closed."));
    }
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      // Closing CDP never releases the Steel browser session.
    }
  }
}

export async function withSteelCdp<T>(sessionId: string, operation: (cdp: SteelCdp) => Promise<T>) {
  const cdp = new SteelCdp(sessionId);
  try {
    await cdp.open();
    return await operation(cdp);
  } finally {
    cdp.close();
  }
}

export async function probeSteelSession(sessionId?: string) {
  if (!sessionId) return false;
  try {
    return await withSteelCdp(sessionId, async (cdp) => {
      await cdp.send("Target.getTargets", {}, undefined, 5_000);
      return true;
    });
  } catch {
    return false;
  }
}

export async function prepareSteelSession(state: SteelBrowserState) {
  if (state.sessionId && await probeSteelSession(state.sessionId)) return { state, recreated: false };
  const next = await createSteelSession(state.profileId);
  await withSteelCdp(next.sessionId!, async (cdp) => {
    await cdp.navigate(BTCC_ASSETS_URL);
  });
  return { state: { ...state, ...next }, recreated: Boolean(state.sessionId) };
}

export function safePageLocation(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown";
  }
}

export function isBtccSignedInUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("btcc.com") && !url.pathname.includes("/login");
  } catch {
    return false;
  }
}
