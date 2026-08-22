import { NextResponse } from "next/server";

import { runBtccDiagnostics } from "@/lib/btcc-diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics = await runBtccDiagnostics();
  const status = diagnostics.category === "ok" ? 200 : 503;

  return NextResponse.json(diagnostics, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}
