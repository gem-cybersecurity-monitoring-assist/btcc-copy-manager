#!/usr/bin/env node
/**
 * Read-only connectivity/authorization smoke test for GEM Muse MCP Bridge.
 * Never prints, persists, or transmits credentials except to the configured
 * MCP endpoint in the Authorization header.
 */
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "https://gem-muse-mcp-bridge.vercel.app/mcp";
const REQUIRED_TOOLS = [
  "muse_bridge_status",
  "muse_get_agent_policy",
  "muse_secret_inventory",
  "muse_prepare_task",
  "muse_validate_change",
  "muse_list_github_tasks",
  "muse_get_repo_snapshot",
  "muse_read_repo_file",
  "muse_propose_file_change",
  "muse_apply_approved_change",
];
const TIMEOUT_MS = 9000;

export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Bridge endpoint must be an HTTPS URL without embedded credentials, query, or fragment.");
  }
  if (url.pathname !== "/mcp") throw new Error("Bridge endpoint must end in /mcp.");
  return url.toString();
}
async function request(endpoint, { fetchImpl = fetch, token, method = "GET", body } = {}) {
  const headers = { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(endpoint, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  let json = null;
  try { json = await response.json(); } catch { /* no sensitive response body reported */ }
  return { status: response.status, json };
}
function rpc(id, method, params) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}
function readToolResult(result) {
  if (result?.error) throw new Error("MCP JSON-RPC error.");
  if (result?.result?.isError) {
    const first = result.result.content?.find((part) => part.type === "text")?.text;
    let code = "MCP tool reported an error";
    try {
      const parsed = JSON.parse(first);
      if (typeof parsed.error === "string") {
        code = parsed.error.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
      }
    } catch {}
    throw new Error(code);
  }
  const first = result?.result?.content?.find((part) => part.type === "text")?.text;
  if (typeof first !== "string") throw new Error("Missing MCP tool response.");
  return JSON.parse(first);
}
export async function checkBridge({ endpoint = DEFAULT_ENDPOINT, token, fetchImpl = fetch } = {}) {
  const url = validateEndpoint(endpoint);
  const output = { endpoint: url, publicStatus: "unchecked", authorizationGuard: "unchecked", toolDiscovery: "not_attempted", privateRepository: "not_attempted", warnings: [] };
  const publicResult = await request(url, { fetchImpl });
  if (publicResult.status !== 200 || publicResult.json?.service !== "GEM Muse MCP Bridge") throw new Error("Public bridge status failed.");
  output.publicStatus = `OK (v${publicResult.json.version || "unknown"})`;
  const denied = await request(url, { fetchImpl, method: "POST", body: rpc(1, "tools/list") });
  if (denied.status !== 401 && denied.status !== 403) throw new Error("Unauthenticated MCP tool discovery was not rejected.");
  output.authorizationGuard = "OK";
  if (!token) {
    output.warnings.push("MCP_BEARER_TOKEN is not configured in this Codespace; authenticated checks skipped.");
    return output;
  }
  const list = await request(url, { fetchImpl, token, method: "POST", body: rpc(2, "tools/list") });
  if (list.status !== 200 || !Array.isArray(list.json?.result?.tools)) throw new Error("Authenticated MCP tool discovery failed.");
  const names = list.json.result.tools.map((tool) => tool.name);
  const missing = REQUIRED_TOOLS.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Bridge missing expected tools: ${missing.join(", ")}`);
  output.toolDiscovery = `OK (${names.length} tools)`;
  const status = await request(url, { fetchImpl, token, method: "POST", body: rpc(3, "tools/call", { name: "muse_bridge_status", arguments: {} }) });
  if (status.status !== 200) throw new Error("Authenticated bridge status failed.");
  const info = readToolResult(status.json);
  output.githubCredentialConfigured = !!info.privateGitHubConfigured;
  output.approvalBackendConfigured = !!info.approvalBackendConfigured;
  const repo = await request(url, { fetchImpl, token, method: "POST", body: rpc(4, "tools/call", { name: "muse_get_repo_snapshot", arguments: {} }) });
  if (repo.status !== 200) throw new Error("GitHub snapshot call returned HTTP error.");
  try {
    const info = readToolResult(repo.json);
    if (info.repository !== "gem-cybersecurity-monitoring-assist/btcc-copy-manager" || info.private !== true) throw new Error("Unexpected repository identity or visibility.");
    output.privateRepository = "OK (authenticated private repository)";
  } catch (error) {
    output.privateRepository = "FAIL";
    output.warnings.push(`Private repository check: ${error.message}`);
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.env.GEM_MUSE_MCP_URL || DEFAULT_ENDPOINT;
  checkBridge({ endpoint, token: process.env.MCP_BEARER_TOKEN })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.privateRepository === "FAIL") process.exitCode = 1;
    })
    .catch(() => {
      // Do not print network error objects; URLs and headers can contain secrets.
      console.error("Bridge health validation failed. Check endpoint reachability and authentication without printing secrets.");
      process.exitCode = 1;
    });
}
