# Dixit_MAE_MFE_Calculator

Step 5 complete: Full-stack MAE/MFE workflow with live dashboard, manual override safety, and analytics charts.

## Backend Stack
- FastAPI
- SQLAlchemy (SQLite)
- yfinance (for Step 2 sync logic)

## Project Structure (Step 2)
```text
Dixit_MAE_MFE_Calculator/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       └── trades.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── config.py
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── dependencies.py
│   │   │   └── session.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── trade.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── trade.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── market_sync.py
│   │   │   └── metrics.py
│   │   ├── __init__.py
│   │   └── main.py
│   └── requirements.txt
└── render.yaml
```

## Database Schema

### `trades`
- `id` (PK)
- `symbol`
- `side` (`Long`/`Short`)
- `entry_date_time`
- `entry_price`
- `stop_loss`
- `quantity`
- `status` (`Open`/`Closed`)
- `exit_date_time` (nullable)
- `exit_price` (nullable)

### `trade_metrics`
- `trade_id` (PK, FK -> `trades.id`)
- `absolute_highest_price_reached`
- `absolute_lowest_price_reached`
- `last_synced_at`

This supports the 7-day workaround architecture by persisting all-time extremes and syncing only incremental data windows.

## Step 2 API Endpoints

### `POST /api/trades`
Creates a new trade and initializes a linked `trade_metrics` row.

Request body:
- `symbol` (auto-normalized to `.NS` when suffix missing)
- `side` (`Long`/`Short`)
- `entry_date_time`
- `entry_price`
- `stop_loss`
- `quantity`

Validation:
- Long: `stop_loss < entry_price`
- Short: `stop_loss > entry_price`

### `GET /api/trades/open`
Returns all open trades with stored metrics plus calculated values:
- `initial_risk`
- `mae_price`, `mfe_price`
- `mae_pct`, `mfe_pct`
- `mae_r`, `mfe_r`

### `POST /api/trades/sync-market-data`
For all open trades:
- Fetches yfinance 5-minute candles from `last_synced_at` (or entry time) to now.
- Clamps start time to now minus 7 days (free intraday constraint).
- Updates persistent all-time high/low in `trade_metrics`.
- Advances `last_synced_at` to now.

This incremental persistence is the 7-day limit workaround.

## Local Run (Backend)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Health check:
```bash
curl http://127.0.0.1:8000/health
```

## Render-Friendly Deployment Notes
- `render.yaml` is included for one-click Render setup.
- App start command uses: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- SQLite uses a persistent Render Disk mounted at `/var/data`.
- Production DB URL in `render.yaml`: `sqlite:////var/data/trades.db`

## Vercel Deployment (Frontend + API with Neon)

This repo runs frontend and API together on Vercel using Next.js route handlers under `frontend/app/api/**`.

### Vercel + Neon Setup Steps
1. In Vercel, import this GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Keep framework as **Next.js**.
4. Add environment variables in Vercel Project Settings:
	- `DATABASE_URL=<neon-connection-string>`
	- `NEXT_PUBLIC_API_BASE_URL=/api`
5. Deploy.

### API Routing on Vercel
- Frontend calls `/api/...` (same-origin).
- Next.js route handlers in `frontend/app/api/**` serve backend endpoints.

### Local Development (unchanged)
- Backend local run still uses `uvicorn` from `backend/`.
- Frontend local run still works with `.env.local` pointing to local backend.

## Environment Variables
`backend/app/core/config.py` supports:
- `APP_NAME`
- `APP_ENV`
- `APP_DEBUG`
- `DATABASE_URL`

`frontend/lib/server/db.ts` supports (first available wins):
- `DATABASE_URL`
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `NEON_DATABASE_URL`

## Frontend Stack (Step 3)
- Next.js (App Router, TypeScript)
- Tailwind CSS
- shadcn-ready component structure

## Frontend Setup Commands
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Default frontend URL:
```bash
http://127.0.0.1:3000
```

## Frontend Structure (Step 3)
```text
frontend/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── dashboard/
│   │   └── dashboard-page.tsx
│   └── ui/
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       └── table.tsx
├── lib/
│   └── utils.ts
├── components.json
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

## Dashboard Layout (Step 3)
Current page includes:
- Header with actions (`Sync Market Data`, `Add Trade`)
- Trade Entry panel placeholder (to connect in Step 4)
- Active Trades table layout with MAE/MFE columns
- MAE vs MFE scatter plot placeholder
- Exit Efficiency chart placeholder

Step 4 will connect this UI to backend APIs and enable live trade creation/table data.

## Frontend Integration (Step 4)

Implemented:
- Live API client in `frontend/lib/api.ts`
- Typed contracts in `frontend/lib/types.ts`
- Interactive dashboard in `frontend/components/dashboard/dashboard-page.tsx`

### Connected UI Actions
- `Add Trade` opens a modal form and calls `POST /api/trades`
- `Sync Market Data` triggers `POST /api/trades/sync-market-data`
- Active Trades table loads from `GET /api/trades/open`

### Active Trades Columns
- Symbol
- Side
- MAE (R)
- MFE (R)
- MAE (%)
- MFE (%)

### CORS for Frontend Access
Backend now supports CORS origins via `API_CORS_ORIGINS`.
Default:
- `http://localhost:3000`
- `http://127.0.0.1:3000`

Set custom origins in backend `.env` as comma-separated values:
```bash
API_CORS_ORIGINS=https://your-frontend-domain.com
```

## Local Full-Stack Run

Backend:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

## Manual MAE/MFE Safety Override (New)

When trades are entered late (after yfinance 5m 7-day window), you can still preserve MAE/MFE math by entering manual extrema.

### Backend Data Model
`trade_metrics` now stores:
- `manual_highest_price_reached`
- `manual_lowest_price_reached`
- `manual_notes`
- `manual_updated_at`

### Effective Extremes Logic
Analytics now use effective values:
- `effective_high = max(auto_high, manual_high)`
- `effective_low = min(auto_low, manual_low)`

Source is tagged as:
- `auto`
- `manual`
- `hybrid`

This guarantees MAE/MFE/R calculations can still work even if auto intraday history is incomplete.

### Manual Override API
- `PATCH /api/trades/{trade_id}/manual-extremes`
- `GET /api/trades?status=all|open|closed`

### Frontend Manual Rights
- Add Trade modal supports optional manual extrema at creation time.
- Active Trades table has per-trade `Manual` edit action.
- Data source badge shows `Auto`, `Manual`, `Hybrid`, or `Pending`.

## Step 5 Charts

Implemented with `recharts`:
- MAE vs MFE Scatter Plot (closed trades, R-multiples)
- Exit Efficiency Chart (realized R vs MFE(R), percentage capture)

If no closed trades exist, the dashboard shows informative empty states.