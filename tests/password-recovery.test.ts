import test from "node:test";
import assert from "node:assert/strict";
import { CloudService, ACCESS_COOKIE, RECOVERY_COOKIE, RECOVERY_VERIFIER_COOKIE } from "../lib/cloud-core.ts";

const code = "12345678-1234-1234-1234-123456789012";
const verifier = "v".repeat(43);
const user = { id: "owner", email_confirmed_at: "2026-11-08T01:00:00Z", is_anonymous: false };
function mock(replies: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const service = new CloudService({ url: "https://example.supabase.co", key: "public" }, async (url, init = {}) => {
    calls.push({ url, init });
    const reply = replies.shift();
    assert.ok(reply, "unexpected upstream call");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  return { service, calls };
}
test("recovery validates email before calling provider", async () => {
  const { service, calls } = mock([]);
  assert.equal((await service.requestRecovery({ email: "bad" }, verifier, "https://app/reset-password")).status, 400);
  assert.equal(calls.length, 0);
});
test("request uses recovery PKCE, fixed redirect and anti-enumeration response", async () => {
  const { service, calls } = mock([{status:200}, {status:404,body:{message:"account not found secret"}}]);
  const a = await service.requestRecovery({ email: " A@Example.com " }, verifier, "https://app/reset-password");
  const b = await service.requestRecovery({ email: "b@example.com" }, verifier, "https://app/reset-password");
  assert.deepEqual(a, b);
  assert.match(calls[0].url, /recover\?redirect_to=https%3A%2F%2Fapp%2Freset-password/);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { email:"a@example.com", code_challenge:verifier, code_challenge_method:"s256" });
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal);
});
test("request surfaces rate and service failures without raw messages", async () => {
  const {service} = mock([{status:429,body:{message:"secret"}}, {status:503,body:{message:"secret"}}]);
  assert.equal((await service.requestRecovery({email:"a@example.com"},verifier,"https://app/reset-password")).status,429);
  const result = await service.requestRecovery({email:"a@example.com"},verifier,"https://app/reset-password");
  assert.equal(result.status,502); assert.ok(!JSON.stringify(result).includes("secret"));
});
test("missing verifier, malformed or replayed code cannot start recovery", async () => {
  const {service,calls}=mock([{status:400,body:{message:"used token secret"}}]);
  assert.equal((await service.exchangeRecovery({code},undefined)).status,400);
  assert.equal((await service.exchangeRecovery({code:"bad"},verifier)).status,400);
  const result=await service.exchangeRecovery({code},verifier);
  assert.equal(calls.length,1); assert.equal(result.status,400);
  assert.ok(result.cookies?.every(c=>c.maxAge===0));
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("code exchange sets only a bounded recovery cookie; no app session or returned tokens", async () => {
  const {service,calls}=mock([{status:200,body:{access_token:"private-access",refresh_token:"private-refresh",expires_in:3600,user}}]);
  const result=await service.exchangeRecovery({code},verifier);
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(calls[0].init.body as string),{auth_code:code,code_verifier:verifier});
  assert.ok(!result.cookies?.some(c=>c.name===ACCESS_COOKIE));
  assert.equal(result.cookies?.find(c=>c.name===RECOVERY_COOKIE)?.maxAge,600);
  assert.equal(result.cookies?.find(c=>c.name===RECOVERY_VERIFIER_COOKIE)?.maxAge,0);
  assert.ok(!JSON.stringify(result.body).includes("private"));
});
test("normal session cookies cannot substitute for the recovery cookie", async () => {
  const {service,calls}=mock([]);
  assert.equal((await service.resetPassword({password:"long-new-password",confirmPassword:"long-new-password"},undefined)).status,401);
  assert.equal(calls.length,0);
});
test("invalid passwords are rejected before any account modification", async () => {
  const {service,calls}=mock([]);
  for(const body of [{password:"short",confirmPassword:"short"},{password:"long-new-password",confirmPassword:"different"},{password:"x".repeat(257),confirmPassword:"x".repeat(257)}])
    assert.equal((await service.resetPassword(body,"recovery")).status,400);
  assert.equal(calls.length,0);
});
test("unconfirmed, anonymous and expired recovery sessions cannot change passwords", async () => {
  for(const body of [{id:"x"}, {...user,is_anonymous:true},{}]) {
    const {service,calls}=mock([{status:200,body}]);
    assert.equal((await service.resetPassword({password:"long-new-password",confirmPassword:"long-new-password"},"recovery")).status,401);
    assert.equal(calls.length,1);
  }
});
test("confirmed recovery updates only password, revokes refresh sessions, clears cookies and requires login", async () => {
  const {service,calls}=mock([{status:200,body:user},{status:200,body:user},{status:200}]);
  const result=await service.resetPassword({password:"long-new-password",confirmPassword:"long-new-password",owner:"attacker",role:"admin"},"private-recovery");
  assert.equal(result.status,200); assert.match(result.body.message as string,/Sign in/);
  assert.deepEqual(JSON.parse(calls[1].init.body as string),{password:"long-new-password"});
  assert.equal(calls[1].init.method,"PUT");
  assert.match(calls[2].url,/logout\?scope=global/);
  assert.ok(result.cookies?.every(c=>c.maxAge===0));
  assert.ok(!JSON.stringify(result.body).includes("private"));
});
test("provider rejection keeps recovery retryable; revocation failure is accurately reported", async () => {
  const {service}=mock([{status:200,body:user},{status:422,body:{error_code:"weak_password",message:"secret"}}]);
  const denied=await service.resetPassword({password:"long-new-password",confirmPassword:"long-new-password"},"recovery");
  assert.equal(denied.status,422); assert.equal(denied.cookies,undefined);
  const {service:other}=mock([{status:200,body:user},{status:200,body:user},{status:503}]);
  const result=await other.resetPassword({password:"long-new-password",confirmPassword:"long-new-password"},"recovery");
  assert.match(result.body.message as string,/could not be confirmed/);
});
