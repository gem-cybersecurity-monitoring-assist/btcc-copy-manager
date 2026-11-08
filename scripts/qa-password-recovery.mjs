import assert from "node:assert/strict";
const { chromium } = await import(process.env.GEM_QA_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.GEM_QA_APP_URL;
assert.ok(base && /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(base), "Local synthetic QA only");
const browser = await chromium.launch({headless:true});
try {
  for (const width of [320,390,1440]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    const page = await context.newPage();
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const fit = async () => assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), "overflow at "+width);
    await page.goto(base+"/sign-in");
    await page.getByRole("link",{name:"Forgot password?",exact:true}).click();
    await page.getByLabel("Email",{exact:true}).fill("synthetic@example.test");
    await page.getByRole("button",{name:"Request recovery email"}).click();
    await page.getByRole("status").filter({hasText:"If this address has an account"}).waitFor();
    await fit();
    const cookies=await context.cookies();
    const verifier=cookies.find(c=>c.name==="gem_cc_recovery_verifier");
    assert.ok(verifier?.httpOnly); assert.ok(verifier?.secure); assert.equal(verifier?.sameSite,"Lax");
    // localhost permits secure cookies, while the backend remains HTTPS with a trusted local fixture CA.
    await page.goto(base+"/reset-password?code=12345678-1234-1234-1234-123456789012");
    await page.getByLabel("New password (12–256 characters)",{exact:true}).waitFor();
    assert.equal(new URL(page.url()).search,"");
    const recoveryCookies=await context.cookies();
    assert.ok(recoveryCookies.find(c=>c.name==="gem_cc_recovery")?.httpOnly);
    assert.ok(!recoveryCookies.some(c=>c.name==="gem_cc_access"||c.name==="gem_cc_refresh"));
    // A recovery session must not pass the ordinary private owner gate.
    const protectedPage=await context.request.get(base+"/copy-center",{maxRedirects:0});
    assert.equal(protectedPage.status(),307);
    await fit();
    await page.getByLabel("New password (12–256 characters)",{exact:true}).fill("synthetic-new-password");
    await page.getByLabel("Confirm new password",{exact:true}).fill("synthetic-new-password");
    await page.getByRole("button",{name:"Change password",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Password changed."}).waitFor();
    assert.ok(!(await context.cookies()).some(c=>c.name==="gem_cc_recovery"));
    await fit();
    // Missing/replayed recovery context is rejected and cannot present the new-password form.
    await page.goto(base+"/reset-password?code=12345678-1234-1234-1234-123456789012");
    await page.getByRole("status").filter({hasText:/expired|different browser/}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Change password",exact:true}).count(),0);
    assert.equal(errors.length,0,errors.join("\n"));
    await context.close();
    console.log("PASS recovery browser "+width);
  }
  for(const path of ["/api/auth/recovery","/api/auth/recovery/exchange","/api/auth/recovery/password"]) {
    const denied=await fetch(base+path,{method:"POST",headers:{Origin:"https://evil.example","Content-Type":"application/json"},body:"{}"});
    assert.equal(denied.status,403);
    assert.match(denied.headers.get("cache-control"),/no-store/);
  }
  // Use a separate synthetic client key so the previous browser journeys' rate budget
  // cannot hide the authorization verdict. Loopback fixture only, not production.
  const denied=await fetch(base+"/api/auth/recovery/password",{method:"POST",headers:{Origin:base,"Content-Type":"application/json","X-Forwarded-For":"192.0.2.55",Cookie:"gem_cc_access=owner-jwt"},body:JSON.stringify({password:"synthetic-new-password",confirmPassword:"synthetic-new-password"})});
  assert.equal(denied.status,401);
  const headers=await fetch(base+"/reset-password");
  assert.equal(headers.headers.get("referrer-policy"),"no-referrer");
  assert.match(headers.headers.get("cache-control"),/no-store/);
  console.log("PASS recovery HTTP CSRF, session separation and no-referrer");
} finally {await browser.close();}
