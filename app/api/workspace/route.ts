import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSession, cloudConfigured, getCloudSession, safeErrorMessage } from "../../../lib/cloud-auth";
export const runtime = "nodejs";
const MAX_BYTES = 750_000;
function supabaseConfig() { return { url: process.env.SUPABASE_URL!.replace(/\/$/, ""), key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }; }
export async function GET(request: NextRequest) {
  if (!cloudConfigured()) return NextResponse.json({ error: "Cloud sync is not configured. Add the required Supabase environment variables and SQL migration." }, { status: 503 });
  const session = await getCloudSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to access your cloud workspace." }, { status: 401 });
  try {
    const { url, key } = supabaseConfig();
    const response = await fetch(url + "/rest/v1/copy_center_workspaces?select=payload,updated_at&user_id=eq." + encodeURIComponent(session.user.id) + "&limit=1", { headers: { apikey: key, Authorization: "Bearer " + session.accessToken }, cache: "no-store" });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(typeof rows?.message === "string" ? rows.message : "Unable to read cloud workspace.");
    const result = NextResponse.json({ ok: true, workspace: Array.isArray(rows) && rows[0] ? rows[0].payload : null, updatedAt: Array.isArray(rows) && rows[0] ? rows[0].updated_at : null });
    applyRefreshedSession(result, session);
    return result;
  } catch (error) { const result = NextResponse.json({ error: safeErrorMessage(error) }, { status: 502 }); applyRefreshedSession(result, session); return result; }
}
export async function PUT(request: NextRequest) {
  if (!cloudConfigured()) return NextResponse.json({ error: "Cloud sync is not configured. Add the required Supabase environment variables and SQL migration." }, { status: 503 });
  const session = await getCloudSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to save your cloud workspace." }, { status: 401 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return NextResponse.json({ error: "Workspace backup is too large (maximum 750 KB)." }, { status: 413 });
  try {
    const body = JSON.parse(raw);
    const workspace = body?.workspace;
    if (!workspace || typeof workspace !== "object" || Array.isArray(workspace) || !Array.isArray(workspace.traders) || !Array.isArray(workspace.savedReviews) || !Array.isArray(workspace.portfolioSnapshots)) return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
    if (workspace.traders.length > 1000 || workspace.savedReviews.length > 1000 || workspace.portfolioSnapshots.length > 5000) return NextResponse.json({ error: "Workspace record limit exceeded." }, { status: 400 });
    const { url, key } = supabaseConfig();
    const response = await fetch(url + "/rest/v1/copy_center_workspaces?on_conflict=user_id", {
      method: "POST", headers: { apikey: key, Authorization: "Bearer " + session.accessToken, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: session.user.id, payload: workspace, updated_at: new Date().toISOString() }), cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Unable to save cloud workspace.");
    const result = NextResponse.json({ ok: true, updatedAt: Array.isArray(data) ? data[0]?.updated_at : new Date().toISOString() });
    applyRefreshedSession(result, session);
    return result;
  } catch (error) { const result = NextResponse.json({ error: safeErrorMessage(error) }, { status: 502 }); applyRefreshedSession(result, session); return result; }
}
