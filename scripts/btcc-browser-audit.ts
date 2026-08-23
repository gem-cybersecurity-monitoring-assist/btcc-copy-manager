import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  extractBtccEvidence,
  isBtccJsonResponse,
  sanitizeBtccUrl,
  sanitizeBtccValue,
  type BtccAuditCheckpoint,
  type BtccAuditCheckpointName,
  type BtccBrowserAuditSnapshot,
  type BtccNetworkObservation
} from "../src/lib/btcc-browser-audit.ts";

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};

type CdpTarget = { type: string; url: string; webSocketDebuggerUrl?: string };
type PendingResponse = { url: string; mimeType: string; resourceType: string; status: number };

const PROFILE_DIR = resolve(process.cwd(), ".btcc-browser-profile");
const DATA_DIR = resolve(process.cwd(), "data", "btcc-browser");
const ACTIVE_PORT_FILE = resolve(PROFILE_DIR, "DevToolsActivePort");
const BTCC_HOME = "https://www.btcc.com/";

const checkpoints: Array<{ name: BtccAuditCheckpointName; instruction: string }> = [
  { name: "account-overview", instruction: "Open BTCC Assets / Account Overview so total account value and wallet balances are visible." },
  { name: "futures", instruction: "Open the Futures assets/positions page so balance, free margin, risk status, positions and PnL are visible." },
  { name: "copy-traders", instruction: "Open Copy Trading > My Copy Traders so active relationships and current copy status are visible." },
  { name: "copy-history", instruction: "Open Copy Trading history / closed copy positions. Show historical PnL and trader attribution if BTCC provides it." },
  { name: "earn", instruction: "Open BTCC Earn. Show available products, your subscriptions, APR/APY, accrued interest and redemption terms." },
  { name: "benefits-rewards", instruction: "Open Benefits / Rewards / Coupons / Trading Funds and show available balances, restrictions and expiration dates." },
  { name: "funding-history", instruction: "Open Futures funding history and show funding received and paid." },
  { name: "referral-affiliate", instruction: "Open Referral / Affiliate pages and show commission status and any realized/pending referral income." },
  { name: "lead-trader-marketplace", instruction: "Open the Copy Trading lead-trader marketplace/rankings and leave the strongest candidate metrics visible." }
];

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function activeProfileBase() {
  try {
    const contents = await readFile(ACTIVE_PORT_FILE, "utf8");
    const port = Number(contents.split(/\r?\n/, 1)[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    const base = `http://127.0.0.1:${port}`;
    await fetchJson(`${base}/json/version`);
    return base;
  } catch {
    return null;
  }
}

function chromeCandidates() {
  const values = [
    process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && resolve(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  return values.filter((value): value is string => Boolean(value));
}

async function launchChrome() {
  const existing = await activeProfileBase();
  if (existing) return existing;

  const chrome = chromeCandidates().find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("Google Chrome was not found in a standard location.");

  const child = spawn(chrome, [
    "--remote-debugging-port=0",
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    BTCC_HOME
  ], { detached: true, stdio: "ignore" });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const base = await activeProfileBase();
    if (base) return base;
    await delay(500);
  }
  throw new Error("Chrome started, but its dedicated local DevTools endpoint did not become available.");
}

async function findBtccTarget(cdpBase: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const targets = await fetchJson<CdpTarget[]>(`${cdpBase}/json/list`);
    const btcc = targets.find((target) => target.type === "page" && target.url.includes("btcc.com") && target.webSocketDebuggerUrl);
    if (btcc?.webSocketDebuggerUrl) return btcc.webSocketDebuggerUrl;
    await delay(500);
  }
  throw new Error("No BTCC Chrome tab was found. Keep the BTCC tab open and run the command again.");
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(message: CdpMessage) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || "CDP request failed."));
        else request.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", () => resolveOpen(), { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("Could not connect to the dedicated local Chrome DevTools endpoint.")), { once: true });
    });
    return new CdpClient(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<T>((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: (value) => resolveRequest(value as T), reject: rejectRequest });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener: (message: CdpMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}

async function evaluatedString(client: CdpClient, expression: string) {
  const result = await client.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return typeof result.result?.value === "string" ? result.result.value : "";
}

function installNetworkCapture(client: CdpClient) {
  const pendingResponses = new Map<string, PendingResponse>();
  let observations: BtccNetworkObservation[] = [];
  let enabled = false;

  client.onEvent((message) => {
    if (message.method === "Network.responseReceived") {
      const params = message.params as {
        requestId?: string;
        type?: string;
        response?: { url?: string; mimeType?: string; status?: number };
      } | undefined;
      if (!params?.requestId || !params.response?.url) return;
      const candidate = {
        url: params.response.url,
        mimeType: params.response.mimeType || "",
        resourceType: params.type || "",
        status: Number(params.response.status || 0)
      };
      if (isBtccJsonResponse(candidate)) pendingResponses.set(params.requestId, candidate);
      return;
    }

    if (message.method === "Network.loadingFinished") {
      const requestId = String(message.params?.requestId || "");
      const meta = pendingResponses.get(requestId);
      if (!meta) return;
      pendingResponses.delete(requestId);
      if (!enabled) return;

      void client.send<{ body?: string; base64Encoded?: boolean }>("Network.getResponseBody", { requestId })
        .then((bodyResult) => {
          let payload: unknown;
          const raw = bodyResult.body || "";
          if (raw.length > 150_000) payload = "[PAYLOAD_TOO_LARGE]";
          else {
            try {
              const decoded = bodyResult.base64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
              payload = sanitizeBtccValue(JSON.parse(decoded));
            } catch {
              payload = undefined;
            }
          }
          observations.push({
            capturedAt: new Date().toISOString(),
            url: sanitizeBtccUrl(meta.url),
            resourceType: meta.resourceType,
            mimeType: meta.mimeType,
            status: meta.status,
            ...(payload === undefined ? {} : { payload })
          });
        })
        .catch(() => undefined);
    }
  });

  return {
    start() {
      observations = [];
      pendingResponses.clear();
      enabled = true;
    },
    async take() {
      await delay(300);
      const result = observations;
      observations = [];
      enabled = false;
      return result;
    }
  };
}

async function captureCheckpoint(client: CdpClient, name: BtccAuditCheckpointName, network: BtccNetworkObservation[]): Promise<BtccAuditCheckpoint> {
  const [url, title, bodyText] = await Promise.all([
    evaluatedString(client, "location.href"),
    evaluatedString(client, "document.title"),
    evaluatedString(client, "document.body ? document.body.innerText : ''")
  ]);
  if (!url.includes("btcc.com")) throw new Error(`The active audit tab is not on BTCC (${sanitizeBtccUrl(url)}).`);
  return { name, capturedAt: new Date().toISOString(), url: sanitizeBtccUrl(url), title, evidence: extractBtccEvidence(bodyText), network };
}

async function main() {
  console.log("BTCC local browser audit — READ ONLY");
  console.log("This command never clicks Buy, Sell, Copy, Stop Copy, Close, Transfer or Withdraw.");
  console.log("Credentials stay in Chrome. Never enter a BTCC password or MFA code in this terminal.\n");

  await mkdir(DATA_DIR, { recursive: true });
  const cdpBase = await launchChrome();
  const targetUrl = await findBtccTarget(cdpBase);
  const client = await CdpClient.connect(targetUrl);
  await client.send("Runtime.enable");
  await client.send("Network.enable", { maxTotalBufferSize: 5_000_000, maxResourceBufferSize: 1_000_000 });

  const rl = createInterface({ input, output });
  const networkCapture = installNetworkCapture(client);
  const results: BtccAuditCheckpoint[] = [];

  try {
    await rl.question("Log in to BTCC in the Chrome window and keep using that same tab. When the authenticated account is visible, press Enter here. ");
    for (const checkpoint of checkpoints) {
      networkCapture.start();
      console.log(`\n[${checkpoint.name}] ${checkpoint.instruction}`);
      const answer = (await rl.question("Navigate there in Chrome, then press Enter to capture (or type s to skip): ")).trim().toLowerCase();
      if (answer === "s") {
        await networkCapture.take();
        continue;
      }
      const network = await networkCapture.take();
      const captured = await captureCheckpoint(client, checkpoint.name, network);
      results.push(captured);
      console.log(`Captured ${captured.evidence.length} relevant visible lines and ${captured.network.length} sanitized BTCC network responses.`);
    }

    const snapshot: BtccBrowserAuditSnapshot = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      mode: "READ_ONLY",
      source: "local-chrome-cdp",
      checkpoints: results
    };
    const timestamp = snapshot.capturedAt.replace(/[:.]/g, "-");
    const archivePath = resolve(DATA_DIR, `snapshot-${timestamp}.json`);
    const latestPath = resolve(DATA_DIR, "latest.json");
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    await Promise.all([writeFile(archivePath, serialized, "utf8"), writeFile(latestPath, serialized, "utf8")]);

    console.log("\nAudit capture complete.");
    console.log(`Saved: ${archivePath}`);
    console.log(`Latest: ${latestPath}`);
    console.log("The Chrome session is left open so you can continue using BTCC normally.");
  } finally {
    rl.close();
    client.close();
  }
}

main().catch((error) => {
  console.error(`BTCC audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
