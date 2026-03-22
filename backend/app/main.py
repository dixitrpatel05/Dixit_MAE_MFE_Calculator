from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import trades_router
from app.core.config import settings
from app.db.base import Base
from app.db.migrations import apply_sqlite_migrations
from app.db.session import engine
from app.models import Trade, TradeMetrics

app = FastAPI(title=settings.app_name)

cors_origins = [origin.strip() for origin in settings.api_cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    if settings.database_url.startswith("sqlite"):
        sqlite_path = settings.database_url.replace("sqlite:///", "", 1)
        db_path = Path(sqlite_path)
        if db_path.parent != Path(""):
            db_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    apply_sqlite_migrations(engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(trades_router)
