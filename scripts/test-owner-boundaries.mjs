// Local synthetic acceptance only. Never uses hosted credentials or databases.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
for (const file of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
])
  assert.ok(
    !fs.existsSync(file),
    "Run synthetic auth QA in a clean checkout without " + file,
  );
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const authPort = await port(),
  appPort = await port();
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-owner-qa-cert-"));
fs.chmodSync(certDir, 0o700);
const qaEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: "production",
  // Enabled only for an isolated synthetic Auth fixture; never forwarded from hosted secrets.
  COPY_CENTER_PASSWORD_RECOVERY_ENABLED: process.env.GEM_QA_RECOVERY_TEST === "1" ? "true" : undefined,
  LD_LIBRARY_PATH: process.env.GEM_QA_BROWSER_LIBS,
  GEM_QA_PLAYWRIGHT_MODULE: process.env.GEM_QA_PLAYWRIGHT_MODULE,
  GEM_QA_CHROMIUM_PATH: process.env.GEM_QA_CHROMIUM_PATH,
  NEXT_TELEMETRY_DISABLED: "1",
  GEM_QA_CERT_DIR: certDir,
  GEM_QA_AUTH_PORT: String(authPort),
  GEM_QA_APP_URL: "http://localhost:" + appPort,
  SUPABASE_URL: "https://localhost:" + authPort,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-publishable-key",
  COPY_CENTER_OWNER_USER_ID: "11111111-1111-4111-8111-111111111111",
  NODE_EXTRA_CA_CERTS: path.join(certDir, "cert.pem"),
};
const children = [];
function child(args) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd: root,
    env: qaEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  process.stdout.on("data", (x) => (log = (log + x).slice(-20000)));
  process.stderr.on("data", (x) => (log = (log + x).slice(-20000)));
  children.push(process);
  return { process, log: () => log };
}
async function ready(url, process, log) {
  for (let i = 0; i < 120; i++) {
    if (process.exitCode !== null) throw Error("QA server stopped: " + log());
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("QA server startup timed out: " + log());
}
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(certDir, "key.pem"),
      "-out",
      path.join(certDir, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  fs.chmodSync(path.join(certDir, "key.pem"), 0o600);
  const mock = child(["scripts/qa-owner-auth-fixture.mjs"]);
  const app = child([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(appPort),
  ]);
  await ready(qaEnv.GEM_QA_APP_URL + "/sign-in", app.process, app.log);
  const check = child(["scripts/qa-owner-http.mjs"]);
  const code = await new Promise((resolve) =>
    check.process.once("exit", resolve),
  );
  assert.equal(code, 0, check.log());
  console.log(check.log());
  // Optional developer browser checks use the same ephemeral, synthetic fixture.
  if (process.env.GEM_QA_BROWSER_SCRIPT) {
    const browser = child([process.env.GEM_QA_BROWSER_SCRIPT]);
    const code = await new Promise((resolve) =>
      browser.process.once("exit", resolve),
    );
    assert.equal(code, 0, browser.log());
    console.log(browser.log());
  }
} finally {
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(
    children
      .filter((c) => c.exitCode === null)
      .map(
        (c) =>
          new Promise((resolve) => {
            const timeout = setTimeout(() => {
              c.kill("SIGKILL");
              resolve();
            }, 3000);
            c.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          }),
      ),
  );
  fs.rmSync(certDir, { recursive: true, force: true });
}
