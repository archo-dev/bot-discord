import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActivityChartPoint,
  PresenceChartSlice,
  RankedChartDatum,
} from "../lib/chart-data.js";
import { formatChartDay } from "../lib/chart-data.js";

export const CHART_COLORS = {
  violet: "#8b5cf6",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#fb7185",
  gray: "#71717a",
  axis: "#777283",
  grid: "#2b2735",
  surface: "#17131f",
} as const;

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

const axisProps = {
  stroke: CHART_COLORS.axis,
  tick: { fill: CHART_COLORS.axis, fontSize: 10 },
  tickLine: false,
  axisLine: false,
} as const;

function TooltipSurface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      data-chart-tooltip
      className="min-w-36 rounded-lg border border-zinc-700/90 bg-[#17131f]/98 px-3 py-2 shadow-(--shadow-lg)"
    >
      <p className="mb-1.5 text-[11px] font-medium text-zinc-400">{title}</p>
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="text-zinc-400">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-zinc-100">{value}</span>
    </div>
  );
}

export function ActivityAreaChart({
  data,
  summary,
  height = 250,
}: {
  data: ActivityChartPoint[];
  summary: string;
  height?: number;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div>
      <div
        data-chart="activity"
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
      >
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="activity-arrivals" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={0.38} />
                <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="activity-departures" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatChartDay}
              minTickGap={24}
              {...axisProps}
            />
            <YAxis allowDecimals={false} width={40} {...axisProps} />
            <Tooltip
              cursor={{ stroke: CHART_COLORS.violet, strokeOpacity: 0.35, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]!.payload as ActivityChartPoint;
                return (
                  <TooltipSurface title={formatChartDay(point.day)}>
                    <TooltipRow color={CHART_COLORS.violet} label="Arrivées" value={numberFormat.format(point.arrivals)} />
                    <TooltipRow color={CHART_COLORS.green} label="Départs" value={numberFormat.format(point.departures)} />
                    <div className="mt-1 border-t border-zinc-700/70 pt-1">
                      <TooltipRow color={CHART_COLORS.gray} label="Total" value={numberFormat.format(point.total)} />
                    </div>
                  </TooltipSurface>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="arrivals"
              name="Arrivées"
              stroke={CHART_COLORS.violet}
              fill="url(#activity-arrivals)"
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, fill: CHART_COLORS.surface }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={500}
            />
            <Area
              type="monotone"
              dataKey="departures"
              name="Départs"
              stroke={CHART_COLORS.green}
              fill="url(#activity-departures)"
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, fill: CHART_COLORS.surface }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-[11px] text-zinc-500">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
          Données du graphique
        </summary>
        <div className="no-scrollbar mt-2 max-h-40 overflow-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
              <tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5 text-right">Arrivées</th><th className="px-2 py-1.5 text-right">Départs</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {data.map((point) => (
                <tr key={point.day}>
                  <td className="px-2 py-1.5">{formatChartDay(point.day)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{point.arrivals}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{point.departures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function RankedBarChart({
  data,
  unit,
  formatValue = (value) => numberFormat.format(value),
  height,
}: {
  data: RankedChartDatum[];
  unit: string;
  formatValue?: (value: number) => string;
  height?: number;
}) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <ol data-chart="ranking" className="space-y-2.5" style={height ? { minHeight: height } : undefined}>
      {data.map((item, index) => (
        <li key={item.id} className="group">
          <div className="mb-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-300" title={item.label}>
              <span className="mr-1.5 text-zinc-600">{index + 1}.</span>
              {item.label}
            </span>
            <span className="ml-auto max-w-full text-right font-semibold tabular-nums text-zinc-100">
              {formatValue(item.value)}
              {unit && <> <span className="font-normal text-zinc-500">{unit}</span></>}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-zinc-800/90"
            title={`${item.label} : ${formatValue(item.value)}${unit ? ` ${unit}` : ""}`}
          >
            <div
              className="h-full min-w-1 rounded-full bg-[linear-gradient(90deg,#6d4be8,#9b7cf7)] transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
          {item.detail && <p className="mt-1 truncate text-[10px] text-zinc-600">{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

export function PresenceDonut({
  slices,
  total,
  summary,
  height = 210,
}: {
  slices: PresenceChartSlice[];
  total: number;
  summary: string;
  height?: number;
}) {
  const reducedMotion = useReducedMotion();
  const visibleSlices = useMemo(() => slices.filter((slice) => slice.value > 0), [slices]);
  return (
    <div data-chart="presence" className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
      <div
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="relative w-full min-w-0 max-w-[230px] outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
      >
        <ResponsiveContainer width="100%" height={height}>
          <PieChart accessibilityLayer>
            <Pie
              data={visibleSlices}
              dataKey="value"
              nameKey="label"
              innerRadius="66%"
              outerRadius="92%"
              paddingAngle={2}
              cornerRadius={5}
              stroke={CHART_COLORS.surface}
              strokeWidth={2}
              isAnimationActive={!reducedMotion}
              animationDuration={500}
            >
              {visibleSlices.map((slice) => <Cell key={slice.id} fill={slice.color} />)}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const slice = payload[0]!.payload as PresenceChartSlice;
                return (
                  <TooltipSurface title={slice.label}>
                    <TooltipRow color={slice.color} label="Membres" value={numberFormat.format(slice.value)} />
                    <TooltipRow color={slice.color} label="Part" value={`${numberFormat.format(slice.percentage)} %`} />
                  </TooltipSurface>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold tabular-nums text-zinc-100">{numberFormat.format(total)}</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">membres</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 grid-cols-1 gap-2">
        {slices.map((slice) => (
          <li key={slice.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/5" style={{ backgroundColor: slice.color }} aria-hidden />
            <span className="truncate text-zinc-400">{slice.label}</span>
            <span className="font-semibold tabular-nums text-zinc-200">
              {numberFormat.format(slice.value)}
              <span className="ml-1 font-normal text-zinc-500">· {numberFormat.format(slice.percentage)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
