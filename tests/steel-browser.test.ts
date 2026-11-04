import assert from "node:assert/strict";
import test from "node:test";
import {
  sealSteelState,
  steelConfigStatus,
  unsealSteelState,
  verifyAuthCookie,
  verifyControlSecret,
  expectedAuthCookie,
} from "../src/lib/steel-browser.ts";

function withSteelEnv(run: () => void) {
  const previous = {
    STEEL_API_KEY: process.env.STEEL_API_KEY,
    STEEL_CONTROL_SECRET: process.env.STEEL_CONTROL_SECRET,
    STEEL_STATE_SECRET: process.env.STEEL_STATE_SECRET,
  };
  process.env.STEEL_API_KEY = "test-steel-key";
  process.env.STEEL_CONTROL_SECRET = "test-control-secret-123456789";
  process.env.STEEL_STATE_SECRET = "test-state-secret-123456789012345";
  try {
    run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Steel configuration requires server secrets and reports safe policy metadata", () => {
  withSteelEnv(() => {
    const status = steelConfigStatus();
    assert.equal(status.ready, true);
    assert.deepEqual(status.missing, []);
    assert.equal(status.timeoutMs, 30 * 60 * 1000);
    assert.equal(status.captchaSolving, true);
    assert.equal(status.inactivityTimeoutDisabled, true);
    assert.equal(status.persistentProfiles, true);
  });
});

test("controller authentication is deterministic and constant-time compatible", () => {
  withSteelEnv(() => {
    assert.equal(verifyControlSecret("test-control-secret-123456789"), true);
    assert.equal(verifyControlSecret("wrong-control-secret-123456789"), false);
    const cookie = expectedAuthCookie();
    assert.equal(verifyAuthCookie(cookie), true);
    assert.equal(verifyAuthCookie(`${cookie}x`), false);
  });
});

test("Steel browser state round-trips through authenticated encryption", () => {
  withSteelEnv(() => {
    const state = {
      sessionId: "session-test",
      profileId: "profile-test",
      viewerUrl: "https://example.invalid/live",
      startedAt: "2026-08-29T20:00:00.000Z",
      timeoutMs: 1_800_000,
    };
    const sealed = sealSteelState(state);
    assert.notEqual(sealed.includes("session-test"), true);
    assert.deepEqual(unsealSteelState(sealed), state);

    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;
    assert.deepEqual(unsealSteelState(tampered), {});
  });
});
