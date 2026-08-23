import { NextResponse } from "next/server";
import { getMarketStatus } from "@/lib/opportunities";
export function GET() { return NextResponse.json(getMarketStatus()); }
