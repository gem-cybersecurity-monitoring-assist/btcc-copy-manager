import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { NextResponse } from "next/server";

import { runBtccDiagnostics } from "@/lib/btcc-diagnostics";

export const dynamic = "force-dynamic";

async function ownerGET() {
  const diagnostics = await runBtccDiagnostics();
  const status = diagnostics.category === "ok" ? 200 : 503;

  return NextResponse.json(diagnostics, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET());
}
