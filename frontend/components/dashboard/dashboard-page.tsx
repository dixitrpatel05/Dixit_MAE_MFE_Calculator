"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, RefreshCw, SquarePen, Trash2, X } from "lucide-react";

import { closeTrade, createTrade, deleteTrade, fetchTrades, syncMarketData, updateManualExtremes, updateTrade } from "@/lib/api";
import type {
  ManualExtremesPayload,
  Trade,
  TradeClosePayload,
  TradeCreatePayload,
  TradeSide,
  TradeUpdatePayload,
} from "@/lib/types";
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

type TradeEditFormState = {
  symbol: string;
  side: TradeSide;
  entryDateTime: string;
  entryPrice: string;
  stopLoss: string;
  quantity: string;
};

type TradeCloseFormState = {
  exitDateTime: string;
  exitPrice: string;
  exitQuantity: string;
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

const defaultEditFormState: TradeEditFormState = {
  symbol: "",
  side: "Long",
  entryDateTime: new Date().toISOString().slice(0, 16),
  entryPrice: "",
  stopLoss: "",
  quantity: "1",
};

const defaultCloseFormState: TradeCloseFormState = {
  exitDateTime: new Date().toISOString().slice(0, 16),
  exitPrice: "",
  exitQuantity: "1",
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

function toDateTimeLocal(isoString: string): string {
  const date = new Date(isoString);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function DashboardPage() {
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isUpdatingTrade, setIsUpdatingTrade] = useState(false);
  const [isClosingTrade, setIsClosingTrade] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncDetails, setSyncDetails] = useState<Array<{ symbol: string; status: "synced" | "skipped"; reason: string }>>([]);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [formState, setFormState] = useState<TradeFormState>(defaultFormState);
  const [editFormState, setEditFormState] = useState<TradeEditFormState>(defaultEditFormState);
  const [closeFormState, setCloseFormState] = useState<TradeCloseFormState>(defaultCloseFormState);
  const [manualFormState, setManualFormState] = useState<ManualOverrideFormState>(
    defaultManualOverrideFormState,
  );

  function showPopup(message: string): void {
    window.alert(message);
  }

  const isManualPromptRequired = useMemo(() => {
    const entry = new Date(formState.entryDateTime);
    if (Number.isNaN(entry.getTime())) {
      return false;
    }
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - entry.getTime() > sevenDaysMs;
  }, [formState.entryDateTime]);

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

  const kpi = useMemo(() => {
    const closedWithAnalytics = closedTrades.filter((trade) => trade.analytics && trade.exit_price !== null);
    if (!closedWithAnalytics.length) {
      return {
        avgMaeR: null,
        avgMfeR: null,
        avgCapturePct: null,
        recommendation: "Close a few trades to unlock personalized MAE/MFE recommendations.",
      };
    }

    const maeValues = closedWithAnalytics
      .map((trade) => trade.analytics?.mae_r)
      .filter((value): value is number => value != null);
    const mfeValues = closedWithAnalytics
      .map((trade) => trade.analytics?.mfe_r)
      .filter((value): value is number => value != null);

    let captureSamples = 0;
    let captureSum = 0;

    for (const trade of closedWithAnalytics) {
      if (!trade.analytics || trade.exit_price == null) {
        continue;
      }

      const realizedPriceMove =
        trade.side === "Long"
          ? trade.exit_price - trade.entry_price
          : trade.entry_price - trade.exit_price;

      const realizedR =
        trade.analytics.initial_risk === 0 ? null : realizedPriceMove / trade.analytics.initial_risk;
      const mfeR = trade.analytics.mfe_r;

      if (realizedR != null && mfeR != null && mfeR !== 0) {
        captureSum += (realizedR / mfeR) * 100;
        captureSamples += 1;
      }
    }

    const avgMaeR = maeValues.length ? maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length : null;
    const avgMfeR = mfeValues.length ? mfeValues.reduce((sum, value) => sum + value, 0) / mfeValues.length : null;
    const avgCapturePct = captureSamples ? captureSum / captureSamples : null;

    let recommendation = "Trade quality is balanced. Keep journaling and refine setup-specific rules.";
    if (avgMaeR != null && avgMaeR < -0.8) {
      recommendation = "Average MAE is deep. Improve entries by waiting for confirmation or reducing size early.";
    } else if (avgCapturePct != null && avgCapturePct < 40 && avgMfeR != null && avgMfeR > 1) {
      recommendation = "You capture a small share of MFE. Test trailing stops or staged exits to keep winners longer.";
    } else if (avgMfeR != null && avgMfeR < 0.7) {
      recommendation = "Average MFE is low. Focus on higher-momentum setups and avoid low-volatility entries.";
    }

    return {
      avgMaeR,
      avgMfeR,
      avgCapturePct,
      recommendation,
    };
  }, [closedTrades]);

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
      setSyncDetails(summary.results.map((item) => ({ symbol: item.symbol, status: item.status, reason: item.reason })));
      await loadTrades();
      const problemRows = summary.results.filter((item) => item.status === "skipped").slice(0, 2);
      const problemHint = problemRows.length
        ? ` ${problemRows.map((row) => `${row.symbol}: ${row.reason}`).join(" | ")}`
        : "";
      const message = `Sync complete. Synced ${summary.synced_trades}/${summary.total_open_trades} open trades.${problemHint}`;
      setSuccessMessage(message);
      showPopup(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Market sync failed.";
      setErrorMessage(message);
      showPopup(message);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleDeleteTrade(trade: Trade): Promise<void> {
    const confirmed = window.confirm(`Delete trade ${trade.symbol}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await deleteTrade(trade.id);
      await loadTrades();
      const message = `Trade ${trade.symbol} deleted.`;
      setSuccessMessage(message);
      showPopup(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete trade.";
      setErrorMessage(message);
      showPopup(message);
    }
  }

  function updateFormField<K extends keyof TradeFormState>(field: K, value: TradeFormState[K]): void {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }

  function updateEditFormField<K extends keyof TradeEditFormState>(
    field: K,
    value: TradeEditFormState[K],
  ): void {
    setEditFormState((prev) => ({ ...prev, [field]: value }));
  }

  function updateCloseFormField<K extends keyof TradeCloseFormState>(
    field: K,
    value: TradeCloseFormState[K],
  ): void {
    setCloseFormState((prev) => ({ ...prev, [field]: value }));
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

    if (isManualPromptRequired && formState.manualHighestPrice.trim() !== "") {
      payload.manual_highest_price_reached = Number(formState.manualHighestPrice);
    }
    if (isManualPromptRequired && formState.manualLowestPrice.trim() !== "") {
      payload.manual_lowest_price_reached = Number(formState.manualLowestPrice);
    }
    if (isManualPromptRequired && formState.manualNotes.trim() !== "") {
      payload.manual_notes = formState.manualNotes.trim();
    }

    if (
      payload.manual_highest_price_reached !== undefined
      && payload.manual_lowest_price_reached !== undefined
      && payload.manual_highest_price_reached < payload.manual_lowest_price_reached
    ) {
      const message = "Manual highest must be greater than or equal to manual lowest.";
      setErrorMessage(message);
      showPopup(message);
      setIsSubmitting(false);
      return;
    }

    try {
      await createTrade(payload);
      setIsModalOpen(false);
      setFormState({ ...defaultFormState, entryDateTime: new Date().toISOString().slice(0, 16) });
      await loadTrades();
      const message = "Trade saved and synced to database.";
      setSuccessMessage(message);
      showPopup(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create trade.";
      setErrorMessage(message);
      showPopup(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openEditModal(trade: Trade): void {
    setEditingTrade(trade);
    setEditFormState({
      symbol: trade.symbol,
      side: trade.side,
      entryDateTime: toDateTimeLocal(trade.entry_date_time),
      entryPrice: trade.entry_price.toString(),
      stopLoss: trade.stop_loss.toString(),
      quantity: trade.quantity.toString(),
    });
    setIsEditModalOpen(true);
  }

  async function handleUpdateTrade(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingTrade) {
      return;
    }

    setIsUpdatingTrade(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload: TradeUpdatePayload = {
      symbol: editFormState.symbol.trim(),
      side: editFormState.side,
      entry_date_time: new Date(editFormState.entryDateTime).toISOString(),
      entry_price: Number(editFormState.entryPrice),
      stop_loss: Number(editFormState.stopLoss),
      quantity: Number(editFormState.quantity),
    };

    try {
      await updateTrade(editingTrade.id, payload);
      await loadTrades();
      const message = `Trade ${editingTrade.symbol} updated and saved.`;
      setSuccessMessage(message);
      showPopup(message);
      setIsEditModalOpen(false);
      setEditingTrade(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update trade.";
      setErrorMessage(message);
      showPopup(message);
    } finally {
      setIsUpdatingTrade(false);
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

  function openCloseModal(trade: Trade): void {
    setClosingTrade(trade);
    setCloseFormState({
      exitDateTime: new Date().toISOString().slice(0, 16),
      exitPrice: "",
      exitQuantity: trade.quantity.toString(),
    });
    setIsCloseModalOpen(true);
  }

  async function handleCloseTrade(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!closingTrade) {
      return;
    }

    setIsClosingTrade(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const payload: TradeClosePayload = {
      exit_date_time: new Date(closeFormState.exitDateTime).toISOString(),
      exit_price: Number(closeFormState.exitPrice),
      exit_quantity: Number(closeFormState.exitQuantity),
    };

    try {
      await closeTrade(closingTrade.id, payload);
      await loadTrades();
      const message = `Trade ${closingTrade.symbol} closed successfully.`;
      setSuccessMessage(message);
      showPopup(message);
      setIsCloseModalOpen(false);
      setClosingTrade(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to close trade.";
      setErrorMessage(message);
      showPopup(message);
    } finally {
      setIsClosingTrade(false);
    }
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
      const message = "Manual highest must be greater than or equal to manual lowest.";
      setErrorMessage(message);
      showPopup(message);
      setIsSavingManual(false);
      return;
    }

    try {
      await updateManualExtremes(selectedTrade.id, payload);
      await loadTrades();
      const message = `Manual extrema saved for ${selectedTrade.symbol}.`;
      setSuccessMessage(message);
      showPopup(message);
      setIsManualModalOpen(false);
      setSelectedTrade(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save manual extrema.";
      setErrorMessage(message);
      showPopup(message);
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

        {syncDetails.length > 0 && (
          <section className="rounded-lg border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Latest Sync Details</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              {syncDetails.slice(0, 8).map((item, index) => (
                <div key={`${item.symbol}-${index}`}>
                  <span className="font-medium text-foreground">{item.symbol}</span>
                  {" · "}
                  <span className={item.status === "synced" ? "text-foreground" : "text-foreground"}>
                    {item.status.toUpperCase()}
                  </span>
                  {" · "}
                  {item.reason}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-3">
          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Avg MAE (R)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{formatSigned(kpi.avgMaeR, "R")}</div>
              <p className="mt-1 text-xs text-muted-foreground">Lower magnitude drawdown is better.</p>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Avg MFE (R)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{formatSigned(kpi.avgMfeR, "R")}</div>
              <p className="mt-1 text-xs text-muted-foreground">Higher favorable excursion shows setup quality.</p>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Avg Exit Capture</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">
                {kpi.avgCapturePct == null ? "--" : `${kpi.avgCapturePct.toFixed(1)}%`}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Realized R as % of available MFE.</p>
            </CardContent>
          </Card>
        </section>

        <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Auto Coaching:</span> {kpi.recommendation}
        </section>

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
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" className="h-8 px-3" onClick={() => openEditModal(trade)}>
                              <SquarePen className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button variant="outline" className="h-8 px-3" onClick={() => openCloseModal(trade)}>
                              Close
                            </Button>
                            <Button variant="outline" className="h-8 px-3" onClick={() => openManualModal(trade)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Manual
                            </Button>
                            <Button
                              variant="outline"
                              className="h-8 px-3"
                              onClick={() => void handleDeleteTrade(trade)}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
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
              {errorMessage && (
                <div className="mb-3 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground">
                  {errorMessage}
                </div>
              )}
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

                {isManualPromptRequired && (
                  <div className="col-span-full rounded-md border p-3">
                    <div className="mb-1 text-sm font-medium">Manual Extremes (Recommended)</div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Trade date is older than 7 days, so Yahoo 5m candles may be unavailable. Add manual values only if
                      auto sync cannot fetch market data.
                    </p>
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
                )}

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

      {isEditModalOpen && editingTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-2xl border-border/90 bg-card/95 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Edit Trade</CardTitle>
                <CardDescription>Update symbol, date/time, side and risk inputs.</CardDescription>
              </div>
              <Button variant="outline" className="h-9 w-9 p-0" onClick={() => setIsEditModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {errorMessage && (
                <div className="mb-3 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground">
                  {errorMessage}
                </div>
              )}
              <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void handleUpdateTrade(event)}>
                <label className="flex flex-col gap-2 text-sm">
                  Symbol
                  <input
                    required
                    value={editFormState.symbol}
                    onChange={(event) => updateEditFormField("symbol", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Side
                  <select
                    value={editFormState.side}
                    onChange={(event) => updateEditFormField("side", event.target.value as TradeSide)}
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
                    value={editFormState.entryDateTime}
                    onChange={(event) => updateEditFormField("entryDateTime", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Quantity
                  <input
                    required
                    min={1}
                    type="number"
                    value={editFormState.quantity}
                    onChange={(event) => updateEditFormField("quantity", event.target.value)}
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
                    value={editFormState.entryPrice}
                    onChange={(event) => updateEditFormField("entryPrice", event.target.value)}
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
                    value={editFormState.stopLoss}
                    onChange={(event) => updateEditFormField("stopLoss", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <div className="col-span-full mt-2 flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isUpdatingTrade}>
                    {isUpdatingTrade ? "Updating..." : "Update Trade"}
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
              {errorMessage && (
                <div className="mb-3 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground">
                  {errorMessage}
                </div>
              )}
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

      {isCloseModalOpen && closingTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-xl border-border/90 bg-card/95 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Close Trade</CardTitle>
                <CardDescription>
                  {closingTrade.symbol} · {closingTrade.side}
                </CardDescription>
              </div>
              <Button variant="outline" className="h-9 w-9 p-0" onClick={() => setIsCloseModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {errorMessage && (
                <div className="mb-3 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground">
                  {errorMessage}
                </div>
              )}
              <form className="grid gap-4" onSubmit={(event) => void handleCloseTrade(event)}>
                <label className="flex flex-col gap-2 text-sm">
                  Exit Date/Time
                  <input
                    required
                    type="datetime-local"
                    value={closeFormState.exitDateTime}
                    onChange={(event) => updateCloseFormField("exitDateTime", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Exit Quantity
                  <input
                    required
                    min={1}
                    max={closingTrade.quantity}
                    type="number"
                    value={closeFormState.exitQuantity}
                    onChange={(event) => updateCloseFormField("exitQuantity", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  Exit Price
                  <input
                    required
                    min={0.01}
                    step="0.01"
                    type="number"
                    value={closeFormState.exitPrice}
                    onChange={(event) => updateCloseFormField("exitPrice", event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2"
                  />
                </label>

                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCloseModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isClosingTrade}>
                    {isClosingTrade ? "Closing..." : "Close Trade"}
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
