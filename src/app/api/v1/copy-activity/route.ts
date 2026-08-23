import { NextResponse } from "next/server";
import { getCopyActivity } from "@/lib/opportunities";
export function GET() { return NextResponse.json(getCopyActivity()); }
