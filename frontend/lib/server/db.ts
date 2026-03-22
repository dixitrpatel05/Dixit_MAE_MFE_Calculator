import { neon } from "@neondatabase/serverless";

let schemaReady: Promise<void> | null = null;
let sqlClient: ReturnType<typeof neon> | null = null;

function getDatabaseUrl(): string {
  const url = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing NETLIFY_DATABASE_URL (or DATABASE_URL).");
  }
  return url;
}

function getClient(): ReturnType<typeof neon> {
  if (!sqlClient) {
    sqlClient = neon(getDatabaseUrl());
  }
  return sqlClient;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getClient()(strings, ...values);
}

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(20) NOT NULL,
      side VARCHAR(10) NOT NULL CHECK (side IN ('Long', 'Short')),
      entry_date_time TIMESTAMPTZ NOT NULL,
      entry_price DOUBLE PRECISION NOT NULL,
      stop_loss DOUBLE PRECISION NOT NULL,
      quantity INTEGER NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
      exit_date_time TIMESTAMPTZ NULL,
      exit_price DOUBLE PRECISION NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS trade_metrics (
      trade_id INTEGER PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
      absolute_highest_price_reached DOUBLE PRECISION NULL,
      absolute_lowest_price_reached DOUBLE PRECISION NULL,
      manual_highest_price_reached DOUBLE PRECISION NULL,
      manual_lowest_price_reached DOUBLE PRECISION NULL,
      manual_notes VARCHAR(300) NULL,
      manual_updated_at TIMESTAMPTZ NULL,
      last_synced_at TIMESTAMPTZ NULL
    )
  `;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema();
  }
  await schemaReady;
}
