import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { openSecret, readKeyring, sealSecret, sealedKeyVersion } from "../lib/connection-secrets.ts";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64url");
const binding = { userId: "11111111-1111-4111-8111-111111111111", connectionId: "33333333-3333-4333-8333-333333333333", venue: "bitget" };
const secret = { apiKey: "bg_test_key_PLAINTEXT", secret: "secret-PLAINTEXT", passphrase: "phrase-PLAINTEXT" };

test("keyring requires a 32-byte key and reports names, never values", () => {
  assert.deepEqual(readKeyring({}).missing, ["CONNECTION_SECRETS_KEY"]);
  assert.equal(readKeyring({}).keyring, null);
  const short = readKeyring({ CONNECTION_SECRETS_KEY: randomBytes(16).toString("base64") });
  assert.equal(short.keyring, null);
  assert.deepEqual(short.invalid, ["CONNECTION_SECRETS_KEY"]);
  assert(!JSON.stringify(short).includes(keyA));
  assert.equal(readKeyring({ CONNECTION_SECRETS_KEY: keyA, CONNECTION_SECRETS_KEY_VERSION: "x" }).keyring, null);
  assert.equal(readKeyring({ CONNECTION_SECRETS_KEY: "ab".repeat(32) }).keyring?.current.key.length, 32);
  assert.equal(readKeyring({ CONNECTION_SECRETS_KEY: keyA }).keyring?.current.version, 1);
});

test("seal then open round-trips without exposing plaintext", () => {
  const { keyring } = readKeyring({ CONNECTION_SECRETS_KEY: keyA });
  const sealed = sealSecret(keyring!, secret, binding);
  assert.match(sealed, /^gcs1\.1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  assert(!sealed.includes("PLAINTEXT"));
  assert.notEqual(sealSecret(keyring!, secret, binding), sealed, "random IV per seal");
  assert.deepEqual(openSecret(keyring!, sealed, binding), secret);
});

test("ciphertext bound to owner, connection and venue cannot be moved", () => {
  const { keyring } = readKeyring({ CONNECTION_SECRETS_KEY: keyA });
  const sealed = sealSecret(keyring!, secret, binding);
  for (const other of [
    { ...binding, userId: "22222222-2222-4222-8222-222222222222" },
    { ...binding, connectionId: "44444444-4444-4444-8444-444444444444" },
    { ...binding, venue: "btcc" },
  ]) assert.throws(() => openSecret(keyring!, sealed, other), /could not be decrypted/);
});

test("tampering, wrong key and unknown versions fail closed with generic errors", () => {
  const { keyring } = readKeyring({ CONNECTION_SECRETS_KEY: keyA });
  const sealed = sealSecret(keyring!, secret, binding);
  const parts = sealed.split(".");
  const flipped = parts[3][0] === "A" ? "B" + parts[3].slice(1) : "A" + parts[3].slice(1);
  assert.throws(() => openSecret(keyring!, [...parts.slice(0, 3), flipped, parts[4]].join("."), binding), /could not be decrypted/);
  const wrong = readKeyring({ CONNECTION_SECRETS_KEY: keyB }).keyring!;
  assert.throws(() => openSecret(wrong, sealed, binding), /could not be decrypted/);
  const v2 = readKeyring({ CONNECTION_SECRETS_KEY: keyB, CONNECTION_SECRETS_KEY_VERSION: "2" }).keyring!;
  assert.throws(() => openSecret(v2, sealed, binding), /unavailable key version/);
  assert.throws(() => openSecret(keyring!, '{"apiKey":"x"}', binding), /recognised format/);
  try { openSecret(wrong, sealed, binding); } catch (error) { assert(!String(error).includes(sealed)); }
});

test("rotation: previous key still opens, current version reported for re-sealing", () => {
  const old = readKeyring({ CONNECTION_SECRETS_KEY: keyA }).keyring!;
  const sealed = sealSecret(old, secret, binding);
  const rotated = readKeyring({
    CONNECTION_SECRETS_KEY: keyB, CONNECTION_SECRETS_KEY_VERSION: "2",
    CONNECTION_SECRETS_PREVIOUS_KEY: keyA, CONNECTION_SECRETS_PREVIOUS_KEY_VERSION: "1",
  }).keyring!;
  assert.deepEqual(openSecret(rotated, sealed, binding), secret);
  assert.equal(sealedKeyVersion(sealed), 1);
  assert.equal(sealedKeyVersion(sealSecret(rotated, secret, binding)), 2);
  assert.equal(readKeyring({
    CONNECTION_SECRETS_KEY: keyB, CONNECTION_SECRETS_KEY_VERSION: "2",
    CONNECTION_SECRETS_PREVIOUS_KEY: keyA, CONNECTION_SECRETS_PREVIOUS_KEY_VERSION: "2",
  }).keyring, null, "previous version must differ");
});
