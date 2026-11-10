import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { btccDepsFromEnv, clearBtccImport, importBtccCsv, type ServiceResult } from "../../../../../../lib/btcc-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 700_000;
const json = (result: ServiceResult) => NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });

/** Import an owner-exported BTCC CSV (balances, positions or copy history). Labelled "owner-imported, not live". */
export async function POST(request: NextRequest) {
  return withOwnerRequest(
    request,
    async (owner) => {
      const text = await request.text().catch(() => "");
      if (text.length > MAX_BODY) return json({ status: 413, body: { ok: false, code: "payload_too_large", error: "The CSV file is larger than 512 KB." } });
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { body = null; }
      return json(await importBtccCsv(btccDepsFromEnv(process.env), owner.userId, body));
    },
    { mutation: true },
  );
}

/** Remove one imported section: ?kind=balances|positions|copy_history */
export async function DELETE(request: NextRequest) {
  return withOwnerRequest(
    request,
    async (owner) => json(await clearBtccImport(btccDepsFromEnv(process.env), owner.userId, request.nextUrl.searchParams.get("kind"))),
    { mutation: true, requireJson: false },
  );
}
