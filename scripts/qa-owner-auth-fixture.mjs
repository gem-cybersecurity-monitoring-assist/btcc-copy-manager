import https from "node:https";
import { createHash } from "node:crypto";
let recoveryChallenge, recoveryUsed = false;
import fs from "node:fs";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let row = {
  payload: {
    traders: [],
    savedReviews: ["QA synthetic research note"],
    portfolioSnapshots: [],
    copyCenter: { budget: "10", maxLoss: "2", activity: [] },
  },
  updated_at: "2026-11-07T10:00:00.000Z",
};
https
  .createServer(
    {
      key: fs.readFileSync(process.env.GEM_QA_CERT_DIR + "/key.pem"),
      cert: fs.readFileSync(process.env.GEM_QA_CERT_DIR + "/cert.pem"),
    },
    async (req, res) => {
      const url = new URL(
        req.url,
        "https://localhost:" + process.env.GEM_QA_AUTH_PORT,
      );
      const send = (code, body = {}) => {
        res.writeHead(code, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(code === 204 ? undefined : JSON.stringify(body));
      };
      let text = "";
      for await (const chunk of req) text += chunk;
      let body = {};
      try {
        body = JSON.parse(text || "{}");
      } catch {}
      const auth = req.headers.authorization;
      if (url.pathname === "/auth/v1/recover") {
        recoveryChallenge = body.code_challenge; recoveryUsed = false;
        return send(200);
      }
      if (url.pathname === "/auth/v1/user") {
        if (auth === "Bearer recovery-jwt")
          return send(200, { id: OWNER, email_confirmed_at: "2026-11-08T00:00:00Z", is_anonymous: false });
        if (auth === "Bearer outage-jwt") return send(503);
        if (auth === "Bearer owner-jwt")
          return send(200, { id: OWNER, email: "owner@example.test" });
        if (auth === "Bearer other-jwt")
          return send(200, { id: OTHER, email: "other@example.test" });
        return send(401);
      }
      if (
        url.pathname === "/auth/v1/signup" ||
        url.pathname === "/auth/v1/resend"
      )
        return send(200, {
          user: { id: OWNER },
          confirmation_sent_at: new Date().toISOString(),
        });
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "pkce") {
          if (recoveryUsed || body.auth_code !== "12345678-1234-1234-1234-123456789012" ||
              createHash("sha256").update(body.code_verifier || "").digest("base64url") !== recoveryChallenge)
            return send(400);
          recoveryUsed = true;
          return send(200, { access_token: "recovery-jwt", refresh_token: "recovery-refresh", expires_in: 3600, user: {id:OWNER} });
        }
        if (
          url.searchParams.get("grant_type") === "refresh_token" &&
          body.refresh_token !== "fixture-refresh"
        )
          return send(401);
        return send(200, {
          access_token: "owner-jwt",
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          user: { id: OWNER, email: "owner@example.test" },
        });
      }
      if (url.pathname === "/auth/v1/logout") return send(204);
      if (url.pathname === "/rest/v1/copy_center_workspaces") {
        if (auth !== "Bearer owner-jwt") return send(403);
        if (req.method === "GET") return send(200, row ? [row] : []);
        if (req.method === "POST" && row) return send(409, { code: "23505" });
        if (
          req.method === "PATCH" &&
          (url.searchParams.get("user_id") !== "eq." + OWNER ||
            url.searchParams.get("updated_at") !== "eq." + row?.updated_at)
        )
          return send(200, []);
        row = { payload: body.payload, updated_at: body.updated_at };
        return send(200, [row]);
      }
      if (url.pathname === "/rest/v1/gem_copy_account_snapshots")
        return send(404, { code: "PGRST205" });
      send(404);
    },
  )
  .listen(Number(process.env.GEM_QA_AUTH_PORT), "127.0.0.1", () =>
    console.log("Local synthetic auth fixture ready"),
  );
