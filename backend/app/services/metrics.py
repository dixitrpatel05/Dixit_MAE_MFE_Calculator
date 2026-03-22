from app.models.trade import Trade, TradeSide
from app.schemas.trade import TradeAnalytics, TradeMetricSnapshot, TradeResponse


def _safe_divide(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _effective_high_low(trade: Trade) -> tuple[float | None, float | None, str | None]:
    metrics = trade.metrics
    if metrics is None:
        return None, None, None

    highs = [
        value
        for value in [
            metrics.absolute_highest_price_reached,
            metrics.manual_highest_price_reached,
        ]
        if value is not None
    ]
    lows = [
        value
        for value in [
            metrics.absolute_lowest_price_reached,
            metrics.manual_lowest_price_reached,
        ]
        if value is not None
    ]

    if not highs or not lows:
        return None, None, None

    effective_high = max(highs)
    effective_low = min(lows)

    used_auto = (
        metrics.absolute_highest_price_reached is not None
        and effective_high == metrics.absolute_highest_price_reached
    ) or (
        metrics.absolute_lowest_price_reached is not None
        and effective_low == metrics.absolute_lowest_price_reached
    )
    used_manual = (
        metrics.manual_highest_price_reached is not None
        and effective_high == metrics.manual_highest_price_reached
    ) or (
        metrics.manual_lowest_price_reached is not None
        and effective_low == metrics.manual_lowest_price_reached
    )

    if used_auto and used_manual:
        source = "hybrid"
    elif used_manual:
        source = "manual"
    else:
        source = "auto"

    return effective_high, effective_low, source


def build_trade_response(trade: Trade) -> TradeResponse:
    metrics = trade.metrics

    snapshot = None
    analytics = None

    if metrics is not None:
        effective_high, effective_low, source = _effective_high_low(trade)
        snapshot = TradeMetricSnapshot(
            absolute_highest_price_reached=metrics.absolute_highest_price_reached,
            absolute_lowest_price_reached=metrics.absolute_lowest_price_reached,
            manual_highest_price_reached=metrics.manual_highest_price_reached,
            manual_lowest_price_reached=metrics.manual_lowest_price_reached,
            manual_notes=metrics.manual_notes,
            manual_updated_at=metrics.manual_updated_at,
            effective_highest_price_reached=effective_high,
            effective_lowest_price_reached=effective_low,
            extremes_source=source,
            last_synced_at=metrics.last_synced_at,
        )

        if effective_high is not None and effective_low is not None and source is not None:
            initial_risk = abs(trade.entry_price - trade.stop_loss)

            if trade.side == TradeSide.LONG:
                mae_price = effective_low - trade.entry_price
                mfe_price = effective_high - trade.entry_price
            else:
                mae_price = trade.entry_price - effective_high
                mfe_price = trade.entry_price - effective_low

            mae_pct = _safe_divide(mae_price, trade.entry_price)
            mfe_pct = _safe_divide(mfe_price, trade.entry_price)
            mae_r = _safe_divide(mae_price, initial_risk)
            mfe_r = _safe_divide(mfe_price, initial_risk)

            analytics = TradeAnalytics(
                initial_risk=initial_risk,
                mae_price=mae_price,
                mfe_price=mfe_price,
                mae_pct=mae_pct,
                mfe_pct=mfe_pct,
                mae_r=mae_r,
                mfe_r=mfe_r,
                extremes_source=source,
            )

    return TradeResponse(
        id=trade.id,
        symbol=trade.symbol,
        side=trade.side,
        entry_date_time=trade.entry_date_time,
        entry_price=trade.entry_price,
        stop_loss=trade.stop_loss,
        quantity=trade.quantity,
        status=trade.status,
        exit_date_time=trade.exit_date_time,
        exit_price=trade.exit_price,
        metrics=snapshot,
        analytics=analytics,
    )
