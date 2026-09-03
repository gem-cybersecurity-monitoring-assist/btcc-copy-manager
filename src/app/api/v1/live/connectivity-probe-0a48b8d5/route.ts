export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url: string) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return { url: new URL(url).origin, ok: true, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return { url: new URL(url).origin, ok: false, error: error instanceof Error ? `${error.name}:${error.message}` : String(error), ms: Date.now() - started };
  }
}

export async function GET() {
  const configured = process.env.BTCC_API_BASE_URL?.trim();
  const targets = [configured, "https://api1.btloginc.com:9081", "https://api1.btloginc.com"].filter((v): v is string => Boolean(v));
  const unique = [...new Set(targets)];
  return Response.json({ probes: await Promise.all(unique.map(probe)) }, { headers: { "cache-control": "no-store" } });
}
