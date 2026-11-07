import test from "node:test";
import assert from "node:assert/strict";
import { checkBridge, validateEndpoint } from "../scripts/check-muse-bridge.mjs";

function response(status, payload) {
  return { status, json: async () => payload };
}
function fakeFetch({ githubOk = true, rejectsAnonymous = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ method: options.method, authorized: !!options.headers.authorization });
    if (options.method === "GET") return response(200, { service: "GEM Muse MCP Bridge", version: "0.5.1" });
    const message = JSON.parse(options.body);
    if (!options.headers.authorization) return response(rejectsAnonymous ? 401 : 200, {});
    if (message.method === "tools/list") {
      return response(200, { result: { tools: [
        "muse_bridge_status", "muse_get_agent_policy", "muse_secret_inventory",
        "muse_prepare_task", "muse_validate_change", "muse_list_github_tasks",
        "muse_get_repo_snapshot", "muse_read_repo_file", "muse_propose_file_change",
        "muse_apply_approved_change"
      ].map(name => ({name})) } });
    }
    if (message.params?.name === "muse_bridge_status") {
      return response(200, { result: { content: [{ type: "text", text: JSON.stringify({ privateGitHubConfigured: true, approvalBackendConfigured: true }) }] } });
    }
    if (message.params?.name === "muse_get_repo_snapshot") {
      return githubOk
        ? response(200, { result: { content: [{type:"text",text:JSON.stringify({repository:"gem-cybersecurity-monitoring-assist/btcc-copy-manager",private:true})}] } })
        : response(200, { result: { isError: true, content: [{type:"text",text:'{"error":"GitHub rejected private read"}'}] } });
    }
    throw new Error("Unexpected request");
  };
  return { fetchImpl, calls };
}
test("rejects insecure endpoints and embedded credentials", () => {
  for (const url of ["http://example.com/mcp", "https://a:b@example.com/mcp", "https://example.com/mcp?key=hidden", "https://example.com/elsewhere"]) {
    assert.throws(() => validateEndpoint(url));
  }
  assert.equal(validateEndpoint("https://gem-muse-mcp-bridge.vercel.app/mcp"), "https://gem-muse-mcp-bridge.vercel.app/mcp");
});
test("public status and unauthorized rejection work without a credential", async () => {
  const mock = fakeFetch();
  const result = await checkBridge({ fetchImpl: mock.fetchImpl });
  assert.equal(result.authorizationGuard, "OK");
  assert.equal(result.toolDiscovery, "not_attempted");
  assert.equal(mock.calls.length, 2);
  assert(mock.calls.every(call => !call.authorized));
});
test("validates authenticated GitHub private repository without returning secrets", async () => {
  const mock = fakeFetch();
  const result = await checkBridge({ fetchImpl: mock.fetchImpl, token: "test-token-not-real" });
  assert.equal(result.privateRepository, "OK (authenticated private repository)");
  assert.equal(result.approvalBackendConfigured, true);
  assert(!JSON.stringify(result).includes("test-token-not-real"));
  assert.equal(mock.calls.length, 5);
});
test("fails closed when anonymous MCP discovery is unexpectedly public", async () => {
  await assert.rejects(checkBridge({ fetchImpl: fakeFetch({ rejectsAnonymous: false }).fetchImpl }), /not rejected/);
});
test("reports private GitHub authentication failure without leaking credentials", async () => {
  const result = await checkBridge({ fetchImpl: fakeFetch({ githubOk: false }).fetchImpl, token: "secret-in-memory" });
  assert.equal(result.privateRepository, "FAIL");
  assert(!JSON.stringify(result).includes("secret-in-memory"));
});
