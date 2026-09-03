import assert from "node:assert/strict";
import test from "node:test";
import { getPurchaseConfigurationStatus, prepareFinitePurchase, switchereSignature, verifyFinitePurchaseToken, verifyPurchaseControlSecret } from "../src/lib/finite-purchase.ts";

const keys = [
  "PURCHASE_CONFIRMATION_SECRET", "LIVE_CONFIRMATION_SECRET", "PURCHASE_CONTROL_SECRET", "PURCHASE_LIVE_EXECUTION",
  "PURCHASE_MAX_TOTAL_FIAT", "PURCHASE_MAX_EXECUTIONS", "BTCC_BTC_DEPOSIT_ADDRESS", "SWITCHERE_PARTNER_API_KEY", "SWITCHERE_PARTNER_API_SECRET"
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
function restore() { for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
function configure() {
  process.env.PURCHASE_CONFIRMATION_SECRET = "purchase-confirmation-secret-with-entropy";
  process.env.PURCHASE_CONTROL_SECRET = "purchase-control-secret";
  process.env.PURCHASE_LIVE_EXECUTION = "true";
  process.env.PURCHASE_MAX_TOTAL_FIAT = "100000";
  process.env.PURCHASE_MAX_EXECUTIONS = "10";
  process.env.BTCC_BTC_DEPOSIT_ADDRESS = "bc1qexampledestinationaddress000000000000000000";
  process.env.SWITCHERE_PARTNER_API_KEY = "partner-key";
  process.env.SWITCHERE_PARTNER_API_SECRET = "partner-secret";
}

function intent(amountPerExecution = 300, executionCount = 2) {
  return {
    amountPerExecution,
    executionCount,
    quoteCurrency: "USD" as const,
    payinGroup: "card" as const,
    clientEmail: "owner@example.com",
    clientIp: "203.0.113.10",
    remoteCountry: "US",
    ownerAcknowledgedTotal: true
  };
}

test("finite purchase supports any configured amount and exact finite count", { concurrency: false }, () => {
  configure();
  const prepared = prepareFinitePurchase(intent(300, 2));
  assert.equal(prepared.amountPerExecution, 300);
  assert.equal(prepared.executionCount, 2);
  assert.equal(prepared.totalAuthorized, 600);
  assert.equal(prepared.children.length, 2);
  assert.notEqual(prepared.children[0].partnerOrderId, prepared.children[1].partnerOrderId);
  assert.match(prepared.confirmationPhrase, /TOTAL 600\.00 USD/);
  restore();
});

test("amount is not hard-coded to 300", { concurrency: false }, () => {
  configure();
  const prepared = prepareFinitePurchase(intent(42.75, 3));
  assert.equal(prepared.totalAuthorized, 128.25);
  assert.deepEqual(prepared.children.map((child) => child.amount), [42.75, 42.75, 42.75]);
  restore();
});

test("full total acknowledgment is mandatory", { concurrency: false }, () => {
  configure();
  assert.throws(() => prepareFinitePurchase({ ...intent(), ownerAcknowledgedTotal: false }), /acknowledge the full finite purchase total/);
  restore();
});

test("signed purchase token verifies without changing the child plan", { concurrency: false }, () => {
  configure();
  const prepared = prepareFinitePurchase(intent(125.5, 2));
  const verified = verifyFinitePurchaseToken(prepared.confirmationToken);
  assert.equal(verified.planId, prepared.planId);
  assert.equal(verified.totalAuthorized, 251);
  assert.deepEqual(verified.children.map((child) => child.partnerOrderId), prepared.children.map((child) => child.partnerOrderId));
  restore();
});

test("configuration fails closed until live connector values are present", { concurrency: false }, () => {
  for (const key of keys) delete process.env[key];
  const status = getPurchaseConfigurationStatus();
  assert.equal(status.ready, false);
  assert.ok(status.missing.includes("SWITCHERE_PARTNER_API_KEY"));
  assert.equal(status.policy.recurring, false);
  restore();
});

test("operator control secret is compared exactly", { concurrency: false }, () => {
  configure();
  assert.equal(verifyPurchaseControlSecret("purchase-control-secret"), true);
  assert.equal(verifyPurchaseControlSecret("wrong-control-secret"), false);
  restore();
});

test("Switchere signature follows path-plus-body SHA256 then HMAC-SHA512", () => {
  const signature = switchereSignature("/api/v2/partner/order/create", '{"a":1}', "secret");
  assert.match(signature, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(signature, switchereSignature("/api/v2/partner/order/create", '{"a":1}', "secret"));
});
