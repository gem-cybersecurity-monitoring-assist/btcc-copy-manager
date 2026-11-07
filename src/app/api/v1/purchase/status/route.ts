import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { getPurchaseConfigurationStatus } from "@/lib/finite-purchase";

async function ownerGET() {
  return Response.json(getPurchaseConfigurationStatus(), {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET());
}
