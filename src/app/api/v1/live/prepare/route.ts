import { prepareLiveOrder } from "@/lib/btcc-live";
import type { LiveOrderIntent } from "@/lib/live-types";

export async function POST(request: Request) {
  try {
    const intent = await request.json() as LiveOrderIntent;
    return Response.json(prepareLiveOrder(intent));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Order preparation failed." }, { status: 422 });
  }
}
