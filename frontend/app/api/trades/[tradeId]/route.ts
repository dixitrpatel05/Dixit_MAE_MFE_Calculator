import { NextRequest, NextResponse } from "next/server";

import { ApiError, deleteTrade, updateTrade } from "@/lib/server/trades";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId } = await context.params;
    const numericId = Number(tradeId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new ApiError(400, "Invalid trade_id.");
    }

    const payload = await request.json();
    const trade = await updateTrade(numericId, payload);
    return NextResponse.json(trade);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Internal server error." }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId } = await context.params;
    const numericId = Number(tradeId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new ApiError(400, "Invalid trade_id.");
    }

    await deleteTrade(numericId);
    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Internal server error." }, { status: 500 });
  }
}
