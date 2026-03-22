from datetime import UTC, datetime, timedelta

import yfinance as yf
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.trade import Trade, TradeMetrics, TradeStatus
from app.schemas.trade import SyncSummary, SyncTradeResult


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _coerce_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def sync_open_trades(db: Session) -> SyncSummary:
    open_trades = db.scalars(select(Trade).where(Trade.status == TradeStatus.OPEN)).all()

    now_utc = _utc_now()
    max_lookback_start = now_utc - timedelta(days=7)

    results: list[SyncTradeResult] = []
    skipped = 0

    for trade in open_trades:
        metrics = trade.metrics
        if metrics is None:
            metrics = TradeMetrics(trade_id=trade.id)
            db.add(metrics)
            db.flush()

        start_time = metrics.last_synced_at or _coerce_utc(trade.entry_date_time)
        start_time = max(_coerce_utc(start_time), max_lookback_start)

        if start_time >= now_utc:
            skipped += 1
            continue

        history = yf.download(
            tickers=trade.symbol,
            start=start_time,
            end=now_utc,
            interval="5m",
            progress=False,
            auto_adjust=False,
            group_by="column",
            threads=False,
        )

        if history.empty or "High" not in history or "Low" not in history:
            metrics.last_synced_at = now_utc
            skipped += 1
            continue

        high_value = float(history["High"].max())
        low_value = float(history["Low"].min())

        old_high = metrics.absolute_highest_price_reached
        old_low = metrics.absolute_lowest_price_reached

        metrics.absolute_highest_price_reached = (
            max(old_high, high_value) if old_high is not None else high_value
        )
        metrics.absolute_lowest_price_reached = (
            min(old_low, low_value) if old_low is not None else low_value
        )
        metrics.last_synced_at = now_utc

        results.append(
            SyncTradeResult(
                trade_id=trade.id,
                symbol=trade.symbol,
                rows_fetched=len(history),
                old_high=old_high,
                new_high=metrics.absolute_highest_price_reached,
                old_low=old_low,
                new_low=metrics.absolute_lowest_price_reached,
                synced_from=start_time,
                synced_to=now_utc,
            )
        )

    db.commit()

    return SyncSummary(
        total_open_trades=len(open_trades),
        synced_trades=len(results),
        skipped_trades=skipped,
        results=results,
    )
