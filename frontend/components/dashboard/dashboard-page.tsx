"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, RefreshCw, X } from "lucide-react";

import { createTrade, fetchTrades, syncMarketData, updateManualExtremes } from "@/lib/api";
import type { ManualExtremesPayload, Trade, TradeCreatePayload, TradeSide } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExitEfficiencyBarChart, MaeMfeScatterChart } from "@/components/dashboard/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TradeFormState = {
  symbol: string;
  side: TradeSide;
  entryDateTime: string;
  entryPrice: string;
  stopLoss: string;
  quantity: string;
  manualHighestPrice: string;
  manualLowestPrice: string;
  manualNotes: string;
};

type ManualOverrideFormState = {
  manualHighestPrice: string;
  manualLowestPrice: string;
  manualNotes: string;
};

const defaultFormState: TradeFormState = {
  symbol: "",
  side: "Long",
  entryDateTime: new Date().toISOString().slice(0, 16),
  entryPrice: "",
  stopLoss: "",
  quantity: "1",
  manualHighestPrice: "",
  manualLowestPrice: "",
  manualNotes: "",
};

const defaultManualOverrideFormState: ManualOverrideFormState = {
  manualHighestPrice: "",
  manualLowestPrice: "",
  manualNotes: "",
};

function formatSigned(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${suffix}`;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return formatSigned(value * 100, "%");
}

export function DashboardPage() {
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [formState, setFormState] = useState<TradeFormState>(defaultFormState);
  const [manualFormState, setManualFormState] = useState<ManualOverrideFormState>(
    defaultManualOverrideFormState,
  );

  const openTrades = useMemo(() => allTrades.filter((trade) => trade.status === "Open"), [allTrades]);
  const closedTrades = useMemo(() => allTrades.filter((trade) => trade.status === "Closed"), [allTrades]);
  const openTradesCount = useMemo(() => openTrades.length, [openTrades]);

  const scatterData = useMemo(
    () =>
      closedTrades
        .filter((trade) => trade.analytics?.mae_r !== null && trade.analytics?.mfe_r !== null)
        .map((trade) => ({
          symbol: trade.symbol,
          maeR: trade.analytics?.mae_r ?? 0,
          mfeR: trade.analytics?.mfe_r ?? 0,
        })),
    [closedTrades],
  );

  const efficiencyData = useMemo(
    () =>
      closedTrades
        .filter((trade) => trade.exit_price !== null && trade.analytics?.initial_risk)
        .map((trade) => {
          if (trade.exit_price === null || !trade.analytics) {
            return null;
          }

          const realizedPriceMove =
            trade.side === "Long" ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price;

          const realizedR =
            trade.analytics.initial_risk === 0 ? null : realizedPriceMove / trade.analytics.initial_risk;

          const mfeR = trade.analytics.mfe_r;
          const efficiencyPct =
            realizedR !== null && mfeR !== null && mfeR !== 0 ? (realizedR / mfeR) * 100 : null;

          return {
            symbol: trade.symbol,
            efficiencyPct,
          };
        })
        .filter((row): row is { symbol: string; efficiencyPct: number | null } => row !== null),
    [closedTrades],
  );

  async function loadTrades(): Promise<void> {
    setIsLoadingTrades(true);
    setErrorMessage(null);
    try {
      const data = await fetchTrades("all");
      setAllTrades(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to fetch trades.");
    } finally {
      setIsLoadingTrades(false);
    }
  }

  useEffect(() => {
    void loadTrades();
  }, []);

  async function handleSyncMarketData(): Promise<void> {
    setIsSyncing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const summary = await syncMarketData();
      await loadTrades();
      setSuccessMessage(
        `Sync complete. Synced ${summary.synced_trades}/${summary.total_open_trades} open trades.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Market sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  function updateFormField<K extends keyof TradeFormState>(field: K, value: TradeFormState[K]): void {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreateTrade(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload: TradeCreatePayload = {
      symbol: formState.symbol.trim(),
      side: formState.side,
      entry_date_time: new Date(formState.entryDateTime).toISOString(),
      entry_price: Number(formState.entryPrice),
      stop_loss: Number(formState.stopLoss),
      quantity: Number(formState.quantity),
    };

    if (formState.manualHighestPrice.trim() !== "") {
      payload.manual_highest_price_reached = Number(formState.manualHighestPrice);
    }
    if (formState.manualLowestPrice.trim() !== "") {
      payload.manual_lowest_price_reached = Number(formState.manualLowestPrice);
    }
    if (formState.manualNotes.trim() !== "") {
      payload.manual_notes = formState.manualNotes.trim();
    }

    if (
      payload.manual_highest_price_reached !== undefined
      && payload.manual_lowest_price_reached !== undefined
      && payload.manual_highest_price_reached < payload.manual_lowest_price_reached
    ) {
      setErrorMessage("Manual highest must be greater than or equal to manual lowest.");
      setIsSubmitting(false);
      return;
    }

    try {
      await createTrade(payload);
      setIsModalOpen(false);
      setFormState({ ...defaultFormState, entryDateTime: new Date().toISOString().slice(0, 16) });
      await loadTrades();
      setSuccessMessage("Trade added successfully.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create trade.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openManualModal(trade: Trade): void {
    setSelectedTrade(trade);
    setManualFormState({
      manualHighestPrice: trade.metrics?.manual_highest_price_reached?.toString() ?? "",
      manualLowestPrice: trade.metrics?.manual_lowest_price_reached?.toString() ?? "",
      manualNotes: trade.metrics?.manual_notes ?? "",
    });
    setIsManualModalOpen(true);
  }

  async function handleSaveManualExtremes(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedTrade) {
      return;
    }

    setIsSavingManual(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload: ManualExtremesPayload = {};

    payload.manual_highest_price_reached =
      manualFormState.manualHighestPrice.trim() === ""
        ? null
        : Number(manualFormState.manualHighestPrice);

    payload.manual_lowest_price_reached =
      manualFormState.manualLowestPrice.trim() === ""
        ? null
        : Number(manualFormState.manualLowestPrice);

    payload.manual_notes = manualFormState.manualNotes.trim() === "" ? null : manualFormState.manualNotes.trim();

    if (
      payload.manual_highest_price_reached !== null
      && payload.manual_lowest_price_reached !== null
      && payload.manual_highest_price_reached < payload.manual_lowest_price_reached
    ) {
      setErrorMessage("Manual highest must be greater than or equal to manual lowest.");
      setIsSavingManual(false);
      return;
    }

    try {
      await updateManualExtremes(selectedTrade.id, payload);
      await loadTrades();
      setSuccessMessage(`Manual extrema saved for ${selectedTrade.symbol}.`);
      setIsManualModalOpen(false);
      setSelectedTrade(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save manual extrema.");
    } finally {
      setIsSavingManual(false);
    }
  }

  function sourceLabel(source: string | null | undefined): string {
    if (source === "hybrid") {
      return "Hybrid";
    }
    if (source === "manual") {
      return "Manual";
    }
    if (source === "auto") {
      return "Auto";
    }
    return "Pending";
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 lg:px-8">
        <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">MAE / MFE Trade Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Track open trades, sync intraday extremes, and evaluate risk-adjusted trade behavior.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => void handleSyncMarketData()} disabled={isSyncing}>
              <RefreshCw className="h-4 w-4" />
              {isSyncing ? "Syncing..." : "Sync Market Data"}
            </Button>
            <Button className="gap-2" onClick={() => setIsModalOpen(true)}>
              <ArrowUpDown className="h-4 w-4" />
              Add Trade
            </Button>
          </div>
        </section>

        {(errorMessage || successMessage) && (
          <section>
            {errorMessage && (
              <div className="rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground">{errorMessage}</div>
            )}
            {successMessage && (
              <div className="rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground">{successMessage}</div>
            )}
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1 border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Trade Entry</CardTitle>
              <CardDescription>
                Capture each executed trade instantly to preserve MAE/MFE precision over long holding periods.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                Fields: Symbol, Side, Entry Date/Time, Entry Price, Stop Loss, Quantity.
              </div>
              <Button className="w-full" onClick={() => setIsModalOpen(true)}>
                Open Trade Entry Form
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Active Trades</CardTitle>
                <CardDescription>
                  Open positions with current MAE/MFE in % and R-multiples (auto + manual override aware).
                </CardDescription>
              </div>
              <Badge>{openTradesCount} Open</Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Data Source</TableHead>
                    <TableHead>MAE (R)</TableHead>
                    <TableHead>MFE (R)</TableHead>
                    <TableHead>MAE (%)</TableHead>
                    <TableHead>MFE (%)</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingTrades && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Loading open trades...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoadingTrades && openTrades.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No open trades yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoadingTrades &&
                    openTrades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="font-medium">{trade.symbol}</TableCell>
                        <TableCell>{trade.side}</TableCell>
                        <TableCell>
                          <Badge>{sourceLabel(trade.metrics?.extremes_source)}</Badge>
                        </TableCell>
                        <TableCell>{formatSigned(trade.analytics?.mae_r, "R")}</TableCell>
                        <TableCell>{formatSigned(trade.analytics?.mfe_r, "R")}</TableCell>
                        <TableCell>{formatPct(trade.analytics?.mae_pct)}</TableCell>
                        <TableCell>{formatPct(trade.analytics?.mfe_pct)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" className="h-8 px-3" onClick={() => openManualModal(trade)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Manual
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>MAE vs MFE Scatter Plot</CardTitle>
              <CardDescription>
                X-axis: MAE (risk taken), Y-axis: MFE (max favorable). Closed trades only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <MaeMfeScatterChart data={scatterData} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Exit Efficiency Chart</CardTitle>
              <CardDescription>
                Compare realized R versus MFE(R) to measure captured opportunity (%).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ExitEfficiencyBarChart data={efficiencyData} />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Manual MAE/MFE Rights: if a trade is entered late (beyond yfinance 7-day 5m availability), you can
          manually set known highest/lowest reached values and keep MAE/MFE averages mathematically valid.
          Effective analytics automatically use the best available combination of auto and manual extrema.
        </section>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-2xl border-border/90 bg-card/95 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Add Trade</CardTitle>
                <CardDescription>Enter trade details exactly at execution time.</CardDescription>
              </div>
              <Button variant="outline" className="h-9 w-9 p-0" onClick={() => setIsModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void handleCreateTrade(event)}>
                <label className="flex flex-col gap-2 text-sm">
                  Symbol
                  <input
                    required
                    value={formState.symbol}
                    onChange={(event) => updateFormField("symbol", event.target.value)}
                    placeholder="RELIANCE.NS"
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Side
                  <select
                    value={formState.side}
                    onChange={(event) => updateFormField("side", event.target.value as TradeSide)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  >
                    <option value="Long">Long</option>
                    <option value="Short">Short</option>
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Entry Date/Time
                  <input
                    required
                    type="datetime-local"
                    value={formState.entryDateTime}
                    onChange={(event) => updateFormField("entryDateTime", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Quantity
                  <input
                    required
                    min={1}
                    type="number"
                    value={formState.quantity}
                    onChange={(event) => updateFormField("quantity", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Entry Price
                  <input
                    required
                    min={0.01}
                    step="0.01"
                    type="number"
                    value={formState.entryPrice}
                    onChange={(event) => updateFormField("entryPrice", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Stop Loss
                  <input
                    required
                    min={0.01}
                    step="0.01"
                    type="number"
                    value={formState.stopLoss}
                    onChange={(event) => updateFormField("stopLoss", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <div className="col-span-full rounded-md border p-3">
                  <div className="mb-2 text-sm font-medium">Optional Manual Extremes (Safety Input)</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm">
                      Manual Highest Reached
                      <input
                        min={0.01}
                        step="0.01"
                        type="number"
                        value={formState.manualHighestPrice}
                        onChange={(event) => updateFormField("manualHighestPrice", event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm">
                      Manual Lowest Reached
                      <input
                        min={0.01}
                        step="0.01"
                        type="number"
                        value={formState.manualLowestPrice}
                        onChange={(event) => updateFormField("manualLowestPrice", event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm md:col-span-2">
                      Note (optional)
                      <input
                        value={formState.manualNotes}
                        onChange={(event) => updateFormField("manualNotes", event.target.value)}
                        placeholder="Source: chart screenshot / broker history"
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                      />
                    </label>
                  </div>
                </div>

                <div className="col-span-full mt-2 flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save Trade"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {isManualModalOpen && selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-xl border-border/90 bg-card/95 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Manual MAE/MFE Override</CardTitle>
                <CardDescription>
                  {selectedTrade.symbol} · {selectedTrade.side}
                </CardDescription>
              </div>
              <Button variant="outline" className="h-9 w-9 p-0" onClick={() => setIsManualModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={(event) => void handleSaveManualExtremes(event)}>
                <label className="flex flex-col gap-2 text-sm">
                  Manual Highest Reached
                  <input
                    min={0.01}
                    step="0.01"
                    type="number"
                    value={manualFormState.manualHighestPrice}
                    onChange={(event) =>
                      setManualFormState((prev) => ({ ...prev, manualHighestPrice: event.target.value }))
                    }
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Manual Lowest Reached
                  <input
                    min={0.01}
                    step="0.01"
                    type="number"
                    value={manualFormState.manualLowestPrice}
                    onChange={(event) =>
                      setManualFormState((prev) => ({ ...prev, manualLowestPrice: event.target.value }))
                    }
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Note (optional)
                  <input
                    value={manualFormState.manualNotes}
                    onChange={(event) =>
                      setManualFormState((prev) => ({ ...prev, manualNotes: event.target.value }))
                    }
                    placeholder="Why manual values were used"
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsManualModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSavingManual}>
                    {isSavingManual ? "Saving..." : "Save Manual Values"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
