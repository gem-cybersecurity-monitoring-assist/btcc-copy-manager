import type { NextRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return withOwnerRequest(request, async () =>
    Response.json({ authorized: true }),
  );
}
