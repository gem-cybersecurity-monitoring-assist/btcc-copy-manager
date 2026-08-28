#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = resolve(process.cwd());
const VENV = join(ROOT, ".sentinel-venv");
const SENTINEL_URL = "http://127.0.0.1:8421";
const MANAGER_URL = "http://127.0.0.1:3000";
const CDP_HTTP = "http://127.0.0.1:9222";
const children = new Set();
let shuttingDown = false;

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return result.status === 0;
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [
        { command: "py", prefix: ["-3"] },
        { command: "python", prefix: [] },
        { command: "python3", prefix: [] },
      ]
    : [
        { command: "python3", prefix: [] },
        { command: "python", prefix: [] },
      ];

  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.prefix, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0) continue;
    const [major, minor] = String(result.stdout).trim().split(".").map(Number);
    if (major > 3 || (major === 3 && minor >= 11)) return candidate;
  }
  return null;
}

function venvPythonPath() {
  return process.platform === "win32"
    ? join(VENV, "Scripts", "python.exe")
    : join(VENV, "bin", "python");
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function ensureSentinelEnvironment() {
  const python = findPython();
  if (!python) {
    throw new Error("Python 3.11+ is required. Install Python 3.11 or newer, then run this command again.");
  }

  const venvPython = venvPythonPath();
  if (!existsSync(venvPython)) {
    console.log("[setup] Creating isolated Sentinel Python environment...");
    runChecked(python.command, [...python.prefix, "-m", "venv", VENV]);
  }

  const versionCheck = spawnSync(
    venvPython,
    ["-c", "import importlib.metadata as m; print(m.version('btcc-sentinel'))"],
    { encoding: "utf8", cwd: ROOT, windowsHide: true },
  );
  const installedVersion = versionCheck.status === 0 ? String(versionCheck.stdout).trim() : "";
  if (installedVersion !== "0.3.1") {
    console.log("[setup] Installing BTCC Sentinel and local test dependencies...");
    runChecked(venvPython, ["-m", "pip", "install", "-e", "./sentinel[dev]"]);
  }

  console.log("[setup] Running Sentinel deterministic tests...");
  runChecked(venvPython, ["-m", "pytest", "sentinel/tests", "-q"]);
  return venvPython;
}

async function fetchOk(url, timeoutMs = 1800) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fetchOk(url)) {
      console.log(`[ready] ${label}: ${url}`);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

function startChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: false,
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function runAndWait(command, args, options = {}) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", windowsHide: false, ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}.`)));
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[stop] Stopping local Sentinel, manager, and monitor processes...");
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function main() {
  console.log("BTCC Sentinel local stack — OBSERVE + WORKFLOW PREP");
  console.log("Authentication remains in the dedicated Chrome profile; this launcher never asks for BTCC credentials.\n");

  if (!commandExists(process.platform === "win32" ? "pnpm.cmd" : "pnpm")) {
    throw new Error("pnpm is required. Install Node.js 24+ and pnpm 10+, then run this command again.");
  }

  mkdirSync(dirname(join(ROOT, "sentinel", "data", "sentinel.db")), { recursive: true });
  const venvPython = ensureSentinelEnvironment();

  if (!(await fetchOk(`${SENTINEL_URL}/health`))) {
    console.log("[start] Starting local Sentinel on 127.0.0.1:8421...");
    startChild(venvPython, ["sentinel/main.py"], {
      env: {
        ...process.env,
        PORT: "8421",
        SENTINEL_DB: join("sentinel", "data", "sentinel.db"),
        SENTINEL_SCAN_INTERVAL: process.env.SENTINEL_SCAN_INTERVAL || "60",
        PYTHONUNBUFFERED: "1",
      },
    });
  }
  await waitFor(`${SENTINEL_URL}/health`, "Sentinel");

  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  if (!(await fetchOk(`${MANAGER_URL}/api/v1/status`))) {
    console.log("[start] Starting BTCC manager on 127.0.0.1:3000...");
    startChild(pnpm, ["dev"], {
      env: { ...process.env, SENTINEL_URL },
    });
  }
  await waitFor(`${MANAGER_URL}/api/v1/status`, "BTCC manager", 45000);
  await waitFor(`${MANAGER_URL}/api/v1/sentinel/health`, "Manager ↔ Sentinel bridge");

  console.log("[start] Launching the isolated BTCC Chrome profile...");
  await runAndWait(process.execPath, ["scripts/launch-btcc-chrome.mjs"], {
    env: { ...process.env, BTCC_CDP_PORT: "9222" },
  });

  const rl = createInterface({ input, output });
  try {
    console.log("\nMANUAL AUTHENTICATION STEP");
    console.log("Sign into BTCC in the Chrome window and complete BTCC 2FA there. Do not enter credentials in this terminal.");
    await rl.question("When your authenticated BTCC page is visible, press Enter here: ");
  } finally {
    rl.close();
  }

  const sharedEnv = {
    ...process.env,
    SENTINEL_URL,
    BTCC_MANAGER_URL: MANAGER_URL,
    BTCC_CDP_HTTP: CDP_HTTP,
  };

  console.log("[verify] Running local connection doctor...");
  await runAndWait(process.execPath, ["scripts/btcc-browser-doctor.mjs"], { env: sharedEnv });

  console.log("[collect] Sending the first credential-safe read-only BTCC snapshot to Sentinel...");
  await runAndWait(process.execPath, ["scripts/btcc-browser-worker.mjs", "--once"], { env: sharedEnv });

  const latestOk = await fetchOk(`${SENTINEL_URL}/state/latest`);
  if (!latestOk) throw new Error("The first collector snapshot did not reach Sentinel.");

  console.log("\nCONNECTED");
  console.log(`Sentinel state: ${SENTINEL_URL}/state/latest`);
  console.log(`Sentinel alerts: ${SENTINEL_URL}/alerts`);
  console.log(`Prepared workflows: ${SENTINEL_URL}/workflow/actions`);
  console.log("[monitor] Starting continuous read-only BTCC monitoring. Press Ctrl+C to stop local processes.");

  const monitor = startChild(process.execPath, ["scripts/btcc-browser-worker.mjs"], { env: sharedEnv });
  await new Promise((resolveMonitor, rejectMonitor) => {
    monitor.once("error", rejectMonitor);
    monitor.once("exit", (code) => code === 0 || shuttingDown ? resolveMonitor() : rejectMonitor(new Error(`BTCC monitor exited with ${code}.`)));
  });
}

main().catch((error) => {
  console.error(`\nBTCC Sentinel startup failed: ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
