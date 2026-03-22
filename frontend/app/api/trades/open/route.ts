import { NextResponse } from "next/server";

import { ApiError, listTrades } from "@/lib/server/trades";

export const runtime = "nodejs";

export async function GET() {
  try {
    const trades = await listTrades("open");
    return NextResponse.json(trades);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Internal server error." }, { status: 500 });
  }
}
