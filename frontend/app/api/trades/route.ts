import { NextRequest, NextResponse } from "next/server";

import { ApiError, createTrade, listTrades } from "@/lib/server/trades";

export const runtime = "nodejs";

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return NextResponse.json({ detail: "Internal server error." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const rawStatus = request.nextUrl.searchParams.get("status") ?? "all";
    const status = rawStatus.toLowerCase();
    if (status !== "all" && status !== "open" && status !== "closed") {
      throw new ApiError(400, "status must be one of: all, open, closed");
    }

    const trades = await listTrades(status);
    return NextResponse.json(trades);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const trade = await createTrade(payload);
    return NextResponse.json(trade, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
