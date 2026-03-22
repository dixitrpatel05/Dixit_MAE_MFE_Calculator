from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.trade import TradeSide, TradeStatus


class TradeCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    side: TradeSide
    entry_date_time: datetime
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    quantity: int = Field(gt=0)
    manual_highest_price_reached: float | None = Field(default=None, gt=0)
    manual_lowest_price_reached: float | None = Field(default=None, gt=0)
    manual_notes: str | None = Field(default=None, max_length=300)

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if cleaned.endswith((".NS", ".BO")):
            return cleaned
        return f"{cleaned}.NS"

    @field_validator("manual_notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        note = value.strip()
        return note or None


class ManualExtremesUpdate(BaseModel):
    manual_highest_price_reached: float | None = Field(default=None, gt=0)
    manual_lowest_price_reached: float | None = Field(default=None, gt=0)
    manual_notes: str | None = Field(default=None, max_length=300)

    @field_validator("manual_notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        note = value.strip()
        return note or None


class TradeMetricSnapshot(BaseModel):
    absolute_highest_price_reached: float | None
    absolute_lowest_price_reached: float | None
    manual_highest_price_reached: float | None
    manual_lowest_price_reached: float | None
    manual_notes: str | None
    manual_updated_at: datetime | None
    effective_highest_price_reached: float | None
    effective_lowest_price_reached: float | None
    extremes_source: str | None
    last_synced_at: datetime | None


class TradeAnalytics(BaseModel):
    initial_risk: float
    mae_price: float
    mfe_price: float
    mae_pct: float | None
    mfe_pct: float | None
    mae_r: float | None
    mfe_r: float | None
    extremes_source: str


class TradeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    side: TradeSide
    entry_date_time: datetime
    entry_price: float
    stop_loss: float
    quantity: int
    status: TradeStatus
    exit_date_time: datetime | None
    exit_price: float | None
    metrics: TradeMetricSnapshot | None
    analytics: TradeAnalytics | None


class SyncTradeResult(BaseModel):
    trade_id: int
    symbol: str
    rows_fetched: int
    old_high: float | None
    new_high: float | None
    old_low: float | None
    new_low: float | None
    synced_from: datetime
    synced_to: datetime


class SyncSummary(BaseModel):
    total_open_trades: int
    synced_trades: int
    skipped_trades: int
    results: list[SyncTradeResult]
