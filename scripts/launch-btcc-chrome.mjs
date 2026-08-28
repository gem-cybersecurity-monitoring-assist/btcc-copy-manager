#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.BTCC_CDP_PORT || "9222";
const profileDir = process.env.BTCC_BROWSER_PROFILE || path.join(os.homedir(), ".btcc-sentinel-chrome");
const startUrl = process.env.BTCC_START_URL || "https://www.btcc.com/";

function candidates() {
  if (process.platform === "win32") {
    return [
      process.env.CHROME_PATH,
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  }
  return [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
}

const executable = candidates().find((candidate) => existsSync(candidate));
if (!executable) {
  console.error("Chrome/Chromium was not found. Install Google Chrome or set CHROME_PATH to its executable.");
  process.exit(1);
}

const args = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  startUrl,
];

console.log(`[chrome] launching isolated BTCC profile at ${profileDir}`);
console.log(`[chrome] DevTools endpoint: http://127.0.0.1:${port}`);
console.log("[chrome] Log into BTCC yourself in the opened window. Passwords and 2FA stay in Chrome and are not sent to Sentinel.");

const child = spawn(executable, args, { detached: true, stdio: "ignore" });
child.unref();
console.log("[chrome] launched");
