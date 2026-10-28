import assert from "node:assert/strict";
import test from "node:test";
import {
  sealSteelState,
  steelConfigStatus,
  unsealSteelState,
  verifyAuthCookie,
  verifyControlSecret,
  expectedAuthCookie,
  STEEL_SESSION_TIMEOUT_MS,
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
    assert.equal(status.timeoutMs, STEEL_SESSION_TIMEOUT_MS);
    assert.equal(status.captchaSolving, false); // disabled in 8515ae6 for Steel Launch-plan compatibility
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

    // Flip a character inside the ciphertext segment. (Changing the final base64url character of the
    // tag can alter only ignored padding bits, which would leave the token byte-for-byte identical.)
    const [version, iv, data, tag] = sealed.split(".");
    const tamperedData = `${data[0] === "A" ? "B" : "A"}${data.slice(1)}`;
    const tampered = [version, iv, tamperedData, tag].join(".");
    assert.deepEqual(unsealSteelState(tampered), {});
  });
});
