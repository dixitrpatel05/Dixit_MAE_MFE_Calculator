import type { ManualExtremesPayload, SyncSummary, Trade, TradeCreatePayload } from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const data = (await response.json()) as { detail?: string };
      detail = data.detail ?? detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export async function fetchOpenTrades(): Promise<Trade[]> {
  return apiRequest<Trade[]>("/api/trades/open");
}

export async function fetchTrades(status: "all" | "open" | "closed" = "all"): Promise<Trade[]> {
  return apiRequest<Trade[]>(`/api/trades?status=${status}`);
}

export async function createTrade(payload: TradeCreatePayload): Promise<Trade> {
  return apiRequest<Trade>("/api/trades", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncMarketData(): Promise<SyncSummary> {
  return apiRequest<SyncSummary>("/api/trades/sync-market-data", {
    method: "POST",
  });
}

export async function updateManualExtremes(
  tradeId: number,
  payload: ManualExtremesPayload,
): Promise<Trade> {
  return apiRequest<Trade>(`/api/trades/${tradeId}/manual-extremes`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
