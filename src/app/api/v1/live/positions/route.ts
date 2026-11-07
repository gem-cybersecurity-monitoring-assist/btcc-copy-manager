import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { getLivePositions } from "@/lib/btcc-live";

async function ownerGET() {
  try { return Response.json(await getLivePositions(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Position sync failed." }, { status: 503 }); }
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET());
}
