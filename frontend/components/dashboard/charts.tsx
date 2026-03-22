"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ScatterPoint = {
  symbol: string;
  maeR: number;
  mfeR: number;
};

type EfficiencyPoint = {
  symbol: string;
  efficiencyPct: number | null;
};

export function MaeMfeScatterChart({ data }: { data: ScatterPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border text-sm text-muted-foreground">
        No closed trades with MAE/MFE data yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 16, right: 20, bottom: 16, left: 8 }}>
        <CartesianGrid strokeDasharray="4 4" />
        <XAxis
          type="number"
          dataKey="maeR"
          name="MAE (R)"
          tickFormatter={(value: number | string) => `${Number(value).toFixed(1)}R`}
        />
        <YAxis
          type="number"
          dataKey="mfeR"
          name="MFE (R)"
          tickFormatter={(value: number | string) => `${Number(value).toFixed(1)}R`}
        />
        <Tooltip cursor={{ strokeDasharray: "4 4" }} />
        <Scatter data={data} fill="hsl(var(--primary))" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ExitEfficiencyBarChart({ data }: { data: EfficiencyPoint[] }) {
  if (!data.some((row) => row.efficiencyPct !== null)) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border text-sm text-muted-foreground">
        No closed trades with exit and MFE data yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 16, left: 8 }}>
        <CartesianGrid strokeDasharray="4 4" />
        <XAxis dataKey="symbol" interval={0} angle={-20} textAnchor="end" height={64} />
        <YAxis tickFormatter={(value: number | string) => `${Number(value).toFixed(0)}%`} />
        <Tooltip />
        <Bar dataKey="efficiencyPct" radius={[6, 6, 0, 0]}>
          {data.map((row) => (
            <Cell
              key={row.symbol}
              fill={row.efficiencyPct !== null && row.efficiencyPct >= 80 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
