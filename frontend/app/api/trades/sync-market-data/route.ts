import { NextResponse } from "next/server";

import { ApiError, syncMarketDataForOpenTrades } from "@/lib/server/trades";

export const runtime = "nodejs";

export async function POST() {
  try {
    const summary = await syncMarketDataForOpenTrades();
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Internal server error." }, { status: 500 });
  }
}
