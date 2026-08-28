import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://api.browserbase.com/v1";

async function bbFetch(path: string, apiKey: string, init?: RequestInit) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function GET() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { ok: false, error: "Browserbase environment is not configured" },
      { status: 503 },
    );
  }

  const contextResponse = await bbFetch("/contexts", apiKey, {
    method: "POST",
    body: JSON.stringify({ name: `btcc-sentinel-${Date.now()}` }),
  });
  const context = await contextResponse.json().catch(() => ({}));

  if (!contextResponse.ok || !context?.id) {
    return NextResponse.json(
      {
        ok: false,
        stage: "context",
        status: contextResponse.status,
        error: "Browserbase context creation failed",
        detail: context,
      },
      { status: contextResponse.status || 502 },
    );
  }

  const sessionResponse = await bbFetch("/sessions", apiKey, {
    method: "POST",
    body: JSON.stringify({
      projectId,
      keepAlive: true,
      timeout: 21600,
      browserSettings: {
        context: { id: context.id, persist: true },
      },
      userMetadata: { purpose: "btcc-sentinel-owner-login" },
    }),
  });
  const session = await sessionResponse.json().catch(() => ({}));

  if (!sessionResponse.ok || !session?.id) {
    return NextResponse.json(
      {
        ok: false,
        stage: "session",
        status: sessionResponse.status,
        error: "Browserbase session creation failed",
        contextId: context.id,
        detail: session,
      },
      { status: sessionResponse.status || 502 },
    );
  }

  const debugResponse = await bbFetch(`/sessions/${encodeURIComponent(session.id)}/debug`, apiKey);
  const debug = await debugResponse.json().catch(() => ({}));

  if (!debugResponse.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: "debug",
        status: debugResponse.status,
        error: "Browserbase Live View lookup failed",
        contextId: context.id,
        sessionId: session.id,
        detail: debug,
      },
      { status: debugResponse.status || 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    contextId: context.id,
    sessionId: session.id,
    liveViewUrl: debug.debuggerFullscreenUrl ?? debug.debuggerUrl,
    btccUrl: "https://www.btcc.com/",
    expiresAt: session.expiresAt,
  });
}
