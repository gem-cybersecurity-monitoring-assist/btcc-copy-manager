import { NextResponse } from "next/server";
import { getOpportunities, scan } from "@/lib/opportunities";
export function GET() { return NextResponse.json({ ...scan(), opportunities: getOpportunities() }); }
export async function POST() { return NextResponse.json(scan()); }
