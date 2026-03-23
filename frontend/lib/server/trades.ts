import yahooFinance from "yahoo-finance2";

import type {
  ManualExtremesPayload,
  SyncSummary,
  Trade,
  TradeCreatePayload,
  TradeUpdatePayload,
} from "@/lib/types";
import { ensureSchema, sql } from "@/lib/server/db";

type TradeRow = {
  id: number;
  symbol: string;
  side: "Long" | "Short";
  entry_date_time: string;
  entry_price: number;
  stop_loss: number;
  quantity: number;
  status: "Open" | "Closed";
  exit_date_time: string | null;
  exit_price: number | null;
  absolute_highest_price_reached: number | null;
  absolute_lowest_price_reached: number | null;
  manual_highest_price_reached: number | null;
  manual_lowest_price_reached: number | null;
  manual_notes: string | null;
  manual_updated_at: string | null;
  last_synced_at: string | null;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeSymbol(value: string): string {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned) {
    throw new ApiError(400, "symbol is required.");
  }
  if (cleaned.endsWith(".NS") || cleaned.endsWith(".BO")) {
    return cleaned;
  }
  return `${cleaned}.NS`;
}

async function resolveYahooSymbol(rawSymbol: string): Promise<string> {
  const cleaned = rawSymbol.trim().toUpperCase();
  if (!cleaned) {
    throw new ApiError(400, "symbol is required.");
  }

  const candidates = Array.from(
    new Set([
      cleaned,
      cleaned.endsWith(".NS") || cleaned.endsWith(".BO") ? cleaned : `${cleaned}.NS`,
      cleaned.endsWith(".NS") || cleaned.endsWith(".BO") ? cleaned : `${cleaned}.BO`,
    ]),
  );

  for (const candidate of candidates) {
    try {
      const quote = (await yahooFinance.quote(candidate)) as { regularMarketPrice?: number | null };
      const marketPrice = quote.regularMarketPrice;
      if (Number.isFinite(marketPrice)) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  try {
    const search = (await yahooFinance.search(cleaned, {
      quotesCount: 8,
      newsCount: 0,
    })) as { quotes?: Array<{ symbol?: string | null }> };
    const quoteCandidates = (search.quotes ?? [])
      .map((item) => item.symbol)
      .filter((symbol): symbol is string => typeof symbol === "string" && symbol.length > 0)
      .filter((symbol) => !symbol.includes("="));

    for (const candidate of quoteCandidates) {
      try {
        const quote = (await yahooFinance.quote(candidate)) as { regularMarketPrice?: number | null };
        if (Number.isFinite(quote.regularMarketPrice)) {
          return candidate.toUpperCase();
        }
      } catch {
        // Keep checking.
      }
    }
  } catch {
    // Ignore search failure and throw clear error below.
  }

  throw new ApiError(400, `No such symbol found on Yahoo Finance for '${cleaned}'.`);
}

function normalizeNotes(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const note = value.trim();
  return note.length ? note : null;
}

function toDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} is invalid.`);
  }
  return date;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function toTradeResponse(row: TradeRow): Trade {
  const autoHigh = row.absolute_highest_price_reached;
  const autoLow = row.absolute_lowest_price_reached;
  const manualHigh = row.manual_highest_price_reached;
  const manualLow = row.manual_lowest_price_reached;

  const highs = [autoHigh, manualHigh].filter((value): value is number => value != null);
  const lows = [autoLow, manualLow].filter((value): value is number => value != null);

  const effectiveHigh = highs.length ? Math.max(...highs) : null;
  const effectiveLow = lows.length ? Math.min(...lows) : null;

  let extremesSource: "auto" | "manual" | "hybrid" | null = null;
  if (effectiveHigh != null && effectiveLow != null) {
    const usedAuto = (autoHigh != null && effectiveHigh === autoHigh) || (autoLow != null && effectiveLow === autoLow);
    const usedManual =
      (manualHigh != null && effectiveHigh === manualHigh) || (manualLow != null && effectiveLow === manualLow);

    if (usedAuto && usedManual) {
      extremesSource = "hybrid";
    } else if (usedManual) {
      extremesSource = "manual";
    } else {
      extremesSource = "auto";
    }
  }

  let analytics: Trade["analytics"] = null;
  if (effectiveHigh != null && effectiveLow != null && extremesSource != null) {
    const initialRisk = Math.abs(row.entry_price - row.stop_loss);
    const maePrice = row.side === "Long" ? effectiveLow - row.entry_price : row.entry_price - effectiveHigh;
    const mfePrice = row.side === "Long" ? effectiveHigh - row.entry_price : row.entry_price - effectiveLow;

    analytics = {
      initial_risk: initialRisk,
      mae_price: maePrice,
      mfe_price: mfePrice,
      mae_pct: safeDivide(maePrice, row.entry_price),
      mfe_pct: safeDivide(mfePrice, row.entry_price),
      mae_r: safeDivide(maePrice, initialRisk),
      mfe_r: safeDivide(mfePrice, initialRisk),
      extremes_source: extremesSource,
    };
  }

  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    entry_date_time: row.entry_date_time,
    entry_price: row.entry_price,
    stop_loss: row.stop_loss,
    quantity: row.quantity,
    status: row.status,
    exit_date_time: row.exit_date_time,
    exit_price: row.exit_price,
    metrics: {
      absolute_highest_price_reached: row.absolute_highest_price_reached,
      absolute_lowest_price_reached: row.absolute_lowest_price_reached,
      manual_highest_price_reached: row.manual_highest_price_reached,
      manual_lowest_price_reached: row.manual_lowest_price_reached,
      manual_notes: row.manual_notes,
      manual_updated_at: row.manual_updated_at,
      effective_highest_price_reached: effectiveHigh,
      effective_lowest_price_reached: effectiveLow,
      extremes_source: extremesSource,
      last_synced_at: row.last_synced_at,
    },
    analytics,
  };
}

async function fetchTradesRows(status: "all" | "open" | "closed"): Promise<TradeRow[]> {
  await ensureSchema();

  if (status === "open") {
    return (await sql`
      SELECT
        t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
        t.status, t.exit_date_time, t.exit_price,
        m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
        m.manual_highest_price_reached, m.manual_lowest_price_reached,
        m.manual_notes, m.manual_updated_at, m.last_synced_at
      FROM trades t
      LEFT JOIN trade_metrics m ON m.trade_id = t.id
      WHERE t.status = 'Open'
      ORDER BY t.id DESC
    `) as unknown as TradeRow[];
  }

  if (status === "closed") {
    return (await sql`
      SELECT
        t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
        t.status, t.exit_date_time, t.exit_price,
        m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
        m.manual_highest_price_reached, m.manual_lowest_price_reached,
        m.manual_notes, m.manual_updated_at, m.last_synced_at
      FROM trades t
      LEFT JOIN trade_metrics m ON m.trade_id = t.id
      WHERE t.status = 'Closed'
      ORDER BY t.id DESC
    `) as unknown as TradeRow[];
  }

  return (await sql`
    SELECT
      t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
      t.status, t.exit_date_time, t.exit_price,
      m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
      m.manual_highest_price_reached, m.manual_lowest_price_reached,
      m.manual_notes, m.manual_updated_at, m.last_synced_at
    FROM trades t
    LEFT JOIN trade_metrics m ON m.trade_id = t.id
    ORDER BY t.id DESC
  `) as unknown as TradeRow[];
}

export async function listTrades(status: "all" | "open" | "closed"): Promise<Trade[]> {
  const rows = await fetchTradesRows(status);
  return rows.map(toTradeResponse);
}

export async function createTrade(payload: TradeCreatePayload): Promise<Trade> {
  await ensureSchema();

  const symbol = await resolveYahooSymbol(normalizeSymbol(payload.symbol));
  const entryDateTime = toDate(payload.entry_date_time, "entry_date_time");

  if (!(payload.entry_price > 0) || !(payload.stop_loss > 0) || !(payload.quantity > 0)) {
    throw new ApiError(400, "entry_price, stop_loss and quantity must be greater than 0.");
  }

  if (payload.side === "Long" && payload.stop_loss >= payload.entry_price) {
    throw new ApiError(400, "For Long trades, stop_loss must be less than entry_price.");
  }

  if (payload.side === "Short" && payload.stop_loss <= payload.entry_price) {
    throw new ApiError(400, "For Short trades, stop_loss must be greater than entry_price.");
  }

  const manualHigh = payload.manual_highest_price_reached ?? null;
  const manualLow = payload.manual_lowest_price_reached ?? null;

  if (manualHigh != null && manualHigh <= 0) {
    throw new ApiError(400, "manual_highest_price_reached must be greater than 0.");
  }
  if (manualLow != null && manualLow <= 0) {
    throw new ApiError(400, "manual_lowest_price_reached must be greater than 0.");
  }
  if (manualHigh != null && manualLow != null && manualHigh < manualLow) {
    throw new ApiError(400, "manual_highest_price_reached must be greater than or equal to manual_lowest_price_reached.");
  }

  const inserted = (await sql`
    INSERT INTO trades (
      symbol,
      side,
      entry_date_time,
      entry_price,
      stop_loss,
      quantity,
      status
    ) VALUES (
      ${symbol},
      ${payload.side},
      ${entryDateTime.toISOString()},
      ${payload.entry_price},
      ${payload.stop_loss},
      ${payload.quantity},
      'Open'
    )
    RETURNING id
  `) as unknown as Array<{ id: number }>;

  const tradeId = inserted[0]?.id;
  if (!tradeId) {
    throw new ApiError(500, "Failed to create trade.");
  }

  const hasManual = manualHigh != null || manualLow != null || payload.manual_notes != null;

  await sql`
    INSERT INTO trade_metrics (
      trade_id,
      manual_highest_price_reached,
      manual_lowest_price_reached,
      manual_notes,
      manual_updated_at
    ) VALUES (
      ${tradeId},
      ${manualHigh},
      ${manualLow},
      ${normalizeNotes(payload.manual_notes)},
      ${hasManual ? new Date().toISOString() : null}
    )
  `;

  const rows = (await sql`
    SELECT
      t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
      t.status, t.exit_date_time, t.exit_price,
      m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
      m.manual_highest_price_reached, m.manual_lowest_price_reached,
      m.manual_notes, m.manual_updated_at, m.last_synced_at
    FROM trades t
    LEFT JOIN trade_metrics m ON m.trade_id = t.id
    WHERE t.id = ${tradeId}
  `) as unknown as TradeRow[];

  return toTradeResponse(rows[0]);
}

export async function updateTrade(tradeId: number, payload: TradeUpdatePayload): Promise<Trade> {
  await ensureSchema();

  const existing = (await sql`SELECT id, status FROM trades WHERE id = ${tradeId}`) as unknown as Array<{
    id: number;
    status: "Open" | "Closed";
  }>;

  if (!existing.length) {
    throw new ApiError(404, "Trade not found.");
  }

  const symbol = await resolveYahooSymbol(normalizeSymbol(payload.symbol));
  const entryDateTime = toDate(payload.entry_date_time, "entry_date_time");

  if (!(payload.entry_price > 0) || !(payload.stop_loss > 0) || !(payload.quantity > 0)) {
    throw new ApiError(400, "entry_price, stop_loss and quantity must be greater than 0.");
  }

  if (payload.side === "Long" && payload.stop_loss >= payload.entry_price) {
    throw new ApiError(400, "For Long trades, stop_loss must be less than entry_price.");
  }

  if (payload.side === "Short" && payload.stop_loss <= payload.entry_price) {
    throw new ApiError(400, "For Short trades, stop_loss must be greater than entry_price.");
  }

  await sql`
    UPDATE trades
    SET
      symbol = ${symbol},
      side = ${payload.side},
      entry_date_time = ${entryDateTime.toISOString()},
      entry_price = ${payload.entry_price},
      stop_loss = ${payload.stop_loss},
      quantity = ${payload.quantity}
    WHERE id = ${tradeId}
  `;

  const rows = (await sql`
    SELECT
      t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
      t.status, t.exit_date_time, t.exit_price,
      m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
      m.manual_highest_price_reached, m.manual_lowest_price_reached,
      m.manual_notes, m.manual_updated_at, m.last_synced_at
    FROM trades t
    LEFT JOIN trade_metrics m ON m.trade_id = t.id
    WHERE t.id = ${tradeId}
  `) as unknown as TradeRow[];

  return toTradeResponse(rows[0]);
}

export async function updateManualExtremes(tradeId: number, payload: ManualExtremesPayload): Promise<Trade> {
  await ensureSchema();

  const tradeRows = (await sql`SELECT id FROM trades WHERE id = ${tradeId}`) as unknown as Array<{ id: number }>;
  if (!tradeRows.length) {
    throw new ApiError(404, "Trade not found.");
  }

  const existingMetrics = (await sql`
    SELECT trade_id, manual_highest_price_reached, manual_lowest_price_reached, manual_notes
    FROM trade_metrics
    WHERE trade_id = ${tradeId}
  `) as unknown as Array<{
    trade_id: number;
    manual_highest_price_reached: number | null;
    manual_lowest_price_reached: number | null;
    manual_notes: string | null;
  }>;

  if (!existingMetrics.length) {
    await sql`INSERT INTO trade_metrics (trade_id) VALUES (${tradeId})`;
  }

  const current = existingMetrics[0] ?? {
    trade_id: tradeId,
    manual_highest_price_reached: null,
    manual_lowest_price_reached: null,
    manual_notes: null,
  };

  const nextManualHigh = payload.manual_highest_price_reached ?? null;
  const nextManualLow = payload.manual_lowest_price_reached ?? null;

  if (nextManualHigh != null && nextManualHigh <= 0) {
    throw new ApiError(400, "manual_highest_price_reached must be greater than 0.");
  }
  if (nextManualLow != null && nextManualLow <= 0) {
    throw new ApiError(400, "manual_lowest_price_reached must be greater than 0.");
  }

  const proposedHigh = payload.manual_highest_price_reached === undefined ? current.manual_highest_price_reached : nextManualHigh;
  const proposedLow = payload.manual_lowest_price_reached === undefined ? current.manual_lowest_price_reached : nextManualLow;

  if (proposedHigh != null && proposedLow != null && proposedHigh < proposedLow) {
    throw new ApiError(400, "manual_highest_price_reached must be greater than or equal to manual_lowest_price_reached.");
  }

  await sql`
    UPDATE trade_metrics
    SET
      manual_highest_price_reached = ${payload.manual_highest_price_reached === undefined ? current.manual_highest_price_reached : nextManualHigh},
      manual_lowest_price_reached = ${payload.manual_lowest_price_reached === undefined ? current.manual_lowest_price_reached : nextManualLow},
      manual_notes = ${payload.manual_notes === undefined ? current.manual_notes : normalizeNotes(payload.manual_notes)},
      manual_updated_at = ${new Date().toISOString()}
    WHERE trade_id = ${tradeId}
  `;

  const rows = (await sql`
    SELECT
      t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
      t.status, t.exit_date_time, t.exit_price,
      m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
      m.manual_highest_price_reached, m.manual_lowest_price_reached,
      m.manual_notes, m.manual_updated_at, m.last_synced_at
    FROM trades t
    LEFT JOIN trade_metrics m ON m.trade_id = t.id
    WHERE t.id = ${tradeId}
  `) as unknown as TradeRow[];

  return toTradeResponse(rows[0]);
}

export async function syncMarketDataForOpenTrades(): Promise<SyncSummary> {
  await ensureSchema();

  const openTrades = (await sql`
    SELECT
      t.id, t.symbol, t.side, t.entry_date_time, t.entry_price, t.stop_loss, t.quantity,
      t.status, t.exit_date_time, t.exit_price,
      m.absolute_highest_price_reached, m.absolute_lowest_price_reached,
      m.manual_highest_price_reached, m.manual_lowest_price_reached,
      m.manual_notes, m.manual_updated_at, m.last_synced_at
    FROM trades t
    LEFT JOIN trade_metrics m ON m.trade_id = t.id
    WHERE t.status = 'Open'
    ORDER BY t.id DESC
  `) as unknown as TradeRow[];

  const now = new Date();
  const maxLookbackStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let syncedTrades = 0;
  let skippedTrades = 0;
  const results: SyncSummary["results"] = [];

  for (const trade of openTrades) {
    const start = trade.last_synced_at ? new Date(trade.last_synced_at) : new Date(trade.entry_date_time);
    const startTime = start > maxLookbackStart ? start : maxLookbackStart;
    const tradeAgeMs = now.getTime() - new Date(trade.entry_date_time).getTime();
    const isBeyondIntradayWindow = tradeAgeMs > 7 * 24 * 60 * 60 * 1000;

    if (startTime >= now) {
      skippedTrades += 1;
      results.push({
        trade_id: trade.id,
        symbol: trade.symbol,
        status: "skipped",
        reason: "Already synced recently.",
      });
      continue;
    }

    try {
      const chart = (await yahooFinance.chart(trade.symbol, {
        period1: startTime,
        period2: now,
        interval: "5m",
      })) as { quotes?: Array<{ high?: number | null; low?: number | null }> };

      const quotes = chart.quotes ?? [];
      const highs = quotes.map((quote) => quote.high).filter((value): value is number => Number.isFinite(value));
      const lows = quotes.map((quote) => quote.low).filter((value): value is number => Number.isFinite(value));

      if (!highs.length || !lows.length) {
        if (isBeyondIntradayWindow) {
          skippedTrades += 1;
          results.push({
            trade_id: trade.id,
            symbol: trade.symbol,
            status: "skipped",
            reason: "No 5m Yahoo data beyond 7 days. Add manual MAE/MFE values.",
          });
          continue;
        }

        try {
          const quote = (await yahooFinance.quote(trade.symbol)) as { regularMarketPrice?: number | null };
          const last = quote.regularMarketPrice;
          if (Number.isFinite(last)) {
            await sql`
              INSERT INTO trade_metrics (
                trade_id,
                absolute_highest_price_reached,
                absolute_lowest_price_reached,
                last_synced_at
              ) VALUES (
                ${trade.id},
                ${last},
                ${last},
                ${now.toISOString()}
              )
              ON CONFLICT (trade_id)
              DO UPDATE SET
                absolute_highest_price_reached = GREATEST(COALESCE(trade_metrics.absolute_highest_price_reached, ${last}), ${last}),
                absolute_lowest_price_reached = LEAST(COALESCE(trade_metrics.absolute_lowest_price_reached, ${last}), ${last}),
                last_synced_at = EXCLUDED.last_synced_at
            `;
            syncedTrades += 1;
            results.push({
              trade_id: trade.id,
              symbol: trade.symbol,
              status: "synced",
              reason: "Fallback synced using latest market price.",
            });
            continue;
          }
        } catch {
          // Fall through to skipped below.
        }

        await sql`
          INSERT INTO trade_metrics (trade_id, last_synced_at)
          VALUES (${trade.id}, ${now.toISOString()})
          ON CONFLICT (trade_id)
          DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at
        `;
        skippedTrades += 1;
        results.push({
          trade_id: trade.id,
          symbol: trade.symbol,
          status: "skipped",
          reason: "No market data returned for this symbol/time range.",
        });
        continue;
      }

      const highValue = Math.max(...highs);
      const lowValue = Math.min(...lows);
      const nextAbsHigh = trade.absolute_highest_price_reached == null ? highValue : Math.max(trade.absolute_highest_price_reached, highValue);
      const nextAbsLow = trade.absolute_lowest_price_reached == null ? lowValue : Math.min(trade.absolute_lowest_price_reached, lowValue);

      await sql`
        INSERT INTO trade_metrics (
          trade_id,
          absolute_highest_price_reached,
          absolute_lowest_price_reached,
          last_synced_at
        ) VALUES (
          ${trade.id},
          ${nextAbsHigh},
          ${nextAbsLow},
          ${now.toISOString()}
        )
        ON CONFLICT (trade_id)
        DO UPDATE SET
          absolute_highest_price_reached = EXCLUDED.absolute_highest_price_reached,
          absolute_lowest_price_reached = EXCLUDED.absolute_lowest_price_reached,
          last_synced_at = EXCLUDED.last_synced_at
      `;

      syncedTrades += 1;
      results.push({
        trade_id: trade.id,
        symbol: trade.symbol,
        status: "synced",
        reason: "Synced from Yahoo 5m candles.",
      });
    } catch (error) {
      skippedTrades += 1;
      const reason = error instanceof Error ? error.message : "Unknown sync error.";
      results.push({
        trade_id: trade.id,
        symbol: trade.symbol,
        status: "skipped",
        reason: `Sync failed: ${reason}`,
      });
    }
  }

  return {
    total_open_trades: openTrades.length,
    synced_trades: syncedTrades,
    skipped_trades: skippedTrades,
    results,
  };
}
