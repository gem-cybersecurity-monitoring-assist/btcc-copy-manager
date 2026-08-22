export async function POST(request: Request) {
  const body = await request.json() as { paused?: boolean };
  const paused = body.paused !== false;
  return Response.json({ paused }, {
    headers: { "Set-Cookie": `btcc-live-paused=${paused ? "1" : "0"}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${paused ? 86400 : 0}` }
  });
}
