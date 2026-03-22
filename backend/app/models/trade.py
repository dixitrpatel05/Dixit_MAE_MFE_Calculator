from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, Enum as SQLEnum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TradeSide(str, Enum):
    LONG = "Long"
    SHORT = "Short"


class TradeStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    side: Mapped[TradeSide] = mapped_column(SQLEnum(TradeSide), nullable=False)

    entry_date_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    status: Mapped[TradeStatus] = mapped_column(
        SQLEnum(TradeStatus),
        nullable=False,
        default=TradeStatus.OPEN,
    )
    exit_date_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)

    metrics: Mapped["TradeMetrics"] = relationship(
        back_populates="trade",
        uselist=False,
        cascade="all, delete-orphan",
    )


class TradeMetrics(Base):
    __tablename__ = "trade_metrics"

    trade_id: Mapped[int] = mapped_column(ForeignKey("trades.id", ondelete="CASCADE"), primary_key=True)
    absolute_highest_price_reached: Mapped[float | None] = mapped_column(Float, nullable=True)
    absolute_lowest_price_reached: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_highest_price_reached: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_lowest_price_reached: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    manual_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    trade: Mapped[Trade] = relationship(back_populates="metrics")
