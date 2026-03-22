export type TradeSide = "Long" | "Short";

export type TradeMetricSnapshot = {
  absolute_highest_price_reached: number | null;
  absolute_lowest_price_reached: number | null;
  manual_highest_price_reached: number | null;
  manual_lowest_price_reached: number | null;
  manual_notes: string | null;
  manual_updated_at: string | null;
  effective_highest_price_reached: number | null;
  effective_lowest_price_reached: number | null;
  extremes_source: "auto" | "manual" | "hybrid" | null;
  last_synced_at: string | null;
};

export type TradeAnalytics = {
  initial_risk: number;
  mae_price: number;
  mfe_price: number;
  mae_pct: number | null;
  mfe_pct: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  extremes_source: "auto" | "manual" | "hybrid";
};

export type Trade = {
  id: number;
  symbol: string;
  side: TradeSide;
  entry_date_time: string;
  entry_price: number;
  stop_loss: number;
  quantity: number;
  status: "Open" | "Closed";
  exit_date_time: string | null;
  exit_price: number | null;
  metrics: TradeMetricSnapshot | null;
  analytics: TradeAnalytics | null;
};

export type TradeCreatePayload = {
  symbol: string;
  side: TradeSide;
  entry_date_time: string;
  entry_price: number;
  stop_loss: number;
  quantity: number;
  manual_highest_price_reached?: number;
  manual_lowest_price_reached?: number;
  manual_notes?: string;
};

export type ManualExtremesPayload = {
  manual_highest_price_reached?: number | null;
  manual_lowest_price_reached?: number | null;
  manual_notes?: string | null;
};

export type SyncSummary = {
  total_open_trades: number;
  synced_trades: number;
  skipped_trades: number;
};
