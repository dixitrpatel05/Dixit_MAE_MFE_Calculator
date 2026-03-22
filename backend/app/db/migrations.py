from sqlalchemy import text
from sqlalchemy.engine import Engine


def apply_sqlite_migrations(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        existing_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(trade_metrics)"))
        }

        if not existing_columns:
            return

        migration_statements: dict[str, str] = {
            "manual_highest_price_reached": "ALTER TABLE trade_metrics ADD COLUMN manual_highest_price_reached FLOAT",
            "manual_lowest_price_reached": "ALTER TABLE trade_metrics ADD COLUMN manual_lowest_price_reached FLOAT",
            "manual_notes": "ALTER TABLE trade_metrics ADD COLUMN manual_notes VARCHAR(300)",
            "manual_updated_at": "ALTER TABLE trade_metrics ADD COLUMN manual_updated_at DATETIME",
        }

        for column_name, statement in migration_statements.items():
            if column_name not in existing_columns:
                connection.execute(text(statement))
