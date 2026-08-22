import { getLivePositions } from "@/lib/btcc-live";

export async function GET() {
  try { return Response.json(await getLivePositions(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Position sync failed." }, { status: 503 }); }
}
