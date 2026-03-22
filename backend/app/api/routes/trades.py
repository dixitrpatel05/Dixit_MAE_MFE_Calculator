from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.dependencies import get_db
from app.models.trade import Trade, TradeMetrics, TradeStatus
from app.schemas.trade import ManualExtremesUpdate, SyncSummary, TradeCreate, TradeResponse
from app.services.metrics import build_trade_response
from app.services.market_sync import sync_open_trades

router = APIRouter(prefix="/api/trades", tags=["trades"])


@router.post("", response_model=TradeResponse, status_code=status.HTTP_201_CREATED)
def create_trade(payload: TradeCreate, db: Session = Depends(get_db)) -> TradeResponse:
    if payload.side.value == "Long" and payload.stop_loss >= payload.entry_price:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="For Long trades, stop_loss must be less than entry_price.",
        )

    if payload.side.value == "Short" and payload.stop_loss <= payload.entry_price:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="For Short trades, stop_loss must be greater than entry_price.",
        )

    trade = Trade(
        symbol=payload.symbol,
        side=payload.side,
        entry_date_time=payload.entry_date_time,
        entry_price=payload.entry_price,
        stop_loss=payload.stop_loss,
        quantity=payload.quantity,
        status=TradeStatus.OPEN,
    )
    db.add(trade)
    db.flush()

    if (
        payload.manual_highest_price_reached is not None
        and payload.manual_lowest_price_reached is not None
        and payload.manual_highest_price_reached < payload.manual_lowest_price_reached
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="manual_highest_price_reached must be greater than or equal to manual_lowest_price_reached.",
        )

    has_manual_extremes = (
        payload.manual_highest_price_reached is not None
        or payload.manual_lowest_price_reached is not None
        or payload.manual_notes is not None
    )

    metrics = TradeMetrics(
        trade_id=trade.id,
        manual_highest_price_reached=payload.manual_highest_price_reached,
        manual_lowest_price_reached=payload.manual_lowest_price_reached,
        manual_notes=payload.manual_notes,
        manual_updated_at=datetime.now(UTC) if has_manual_extremes else None,
    )
    db.add(metrics)

    db.commit()
    db.refresh(trade)
    return build_trade_response(trade)


@router.get("", response_model=list[TradeResponse])
def list_trades(
    status_filter: str = Query(default="all", alias="status"),
    db: Session = Depends(get_db),
) -> list[TradeResponse]:
    query = select(Trade)
    normalized_status = status_filter.strip().lower()

    if normalized_status == "open":
        query = query.where(Trade.status == TradeStatus.OPEN)
    elif normalized_status == "closed":
        query = query.where(Trade.status == TradeStatus.CLOSED)
    elif normalized_status != "all":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="status must be one of: all, open, closed",
        )

    trades = db.scalars(query).all()
    return [build_trade_response(trade) for trade in trades]


@router.get("/open", response_model=list[TradeResponse])
def list_open_trades(db: Session = Depends(get_db)) -> list[TradeResponse]:
    trades = db.scalars(select(Trade).where(Trade.status == TradeStatus.OPEN)).all()
    return [build_trade_response(trade) for trade in trades]


@router.post("/sync-market-data", response_model=SyncSummary)
def sync_market_data(db: Session = Depends(get_db)) -> SyncSummary:
    return sync_open_trades(db)


@router.patch("/{trade_id}/manual-extremes", response_model=TradeResponse)
def update_manual_extremes(
    trade_id: int,
    payload: ManualExtremesUpdate,
    db: Session = Depends(get_db),
) -> TradeResponse:
    trade = db.get(Trade, trade_id)
    if trade is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trade not found.")

    metrics = trade.metrics
    if metrics is None:
        metrics = TradeMetrics(trade_id=trade.id)
        db.add(metrics)
        db.flush()

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return build_trade_response(trade)

    proposed_high = updates.get("manual_highest_price_reached", metrics.manual_highest_price_reached)
    proposed_low = updates.get("manual_lowest_price_reached", metrics.manual_lowest_price_reached)

    if proposed_high is not None and proposed_low is not None and proposed_high < proposed_low:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="manual_highest_price_reached must be greater than or equal to manual_lowest_price_reached.",
        )

    if "manual_highest_price_reached" in updates:
        metrics.manual_highest_price_reached = updates["manual_highest_price_reached"]
    if "manual_lowest_price_reached" in updates:
        metrics.manual_lowest_price_reached = updates["manual_lowest_price_reached"]
    if "manual_notes" in updates:
        metrics.manual_notes = updates["manual_notes"]

    metrics.manual_updated_at = datetime.now(UTC)

    db.commit()
    db.refresh(trade)
    return build_trade_response(trade)
