import { NextRequest, NextResponse } from "next/server";
import { applyRefreshedSession, cloudConfigured, getCloudSession, safeErrorMessage } from "@/lib/cloud-auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!cloudConfigured()) return NextResponse.json({ configured: false, authenticated: false, error: "Cloud sync is not configured yet." });
  try {
    const session = await getCloudSession(request);
    const response = NextResponse.json({ configured: true, authenticated: Boolean(session), user: session?.user ?? null });
    applyRefreshedSession(response, session);
    return response;
  } catch (error) { return NextResponse.json({ configured: true, authenticated: false, error: safeErrorMessage(error) }); }
}
