import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MemberDeltaPoint, MemberSnapshotPoint, PresenceStatsDto } from "@bot/shared";

/*
 * Recharts wrappers for the Stats page (M19). Dark-theme only (Nocturne), styled
 * from the --viz-* tokens. Colors are assigned by role (skill: dataviz) and the
 * categorical pair violet↔green is CVD-validated (ΔE > 100); text uses ink
 * tokens, never a series color; every chart has an empty state.
 */

const VIZ = {
  violet: "#7c4dee",
  blue: "#3e7afc",
  green: "#1fc069",
  amber: "#f0b114",
  red: "#ed4b4b",
  gray: "#4b5163",
} as const;

const AXIS = "#6b7180"; // text-muted
const GRID = "#232838"; // border
const SURFACE = "#1a1f2e"; // surface-2 (tooltip bg)

function EmptyChart({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center text-center text-sm text-zinc-500" style={{ height }}>
      {children}
    </div>
  );
}

/** Dark tooltip; labels/values in ink tokens, a small colored dot carries identity. */
function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-(--surface-2) px-3 py-2 shadow-(--shadow-md)">
      <div className="mb-1 text-xs font-medium text-zinc-400">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="text-zinc-400">{r.label}</span>
          <span className="ml-auto font-semibold text-zinc-100 tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

// --- Members over time (humans vs bots) ------------------------------------

function formatBucket(bucket: string, hourly: boolean): string {
  const d = new Date(`${bucket}:00Z`);
  if (Number.isNaN(d.getTime())) return bucket;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return hourly ? `${day}/${month} ${String(d.getUTCHours()).padStart(2, "0")}h` : `${day}/${month}`;
}

export function MembersChart({ data, hourly, height = 260 }: { data: MemberSnapshotPoint[]; hourly: boolean; height?: number }) {
  if (data.length === 0) {
    return (
      <EmptyChart height={height}>
        Pas encore de données de membres. Les snapshots sont pris chaque heure par le service Gateway.
      </EmptyChart>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={(b: string) => formatBucket(b, hourly)} minTickGap={28} {...axisProps} />
        <YAxis allowDecimals={false} width={44} {...axisProps} />
        <Tooltip
          cursor={{ stroke: GRID }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as MemberSnapshotPoint;
            return (
              <TooltipBox
                title={formatBucket(p.bucket, hourly)}
                rows={[
                  { label: "Humains", value: String(p.humans), color: VIZ.violet },
                  { label: "Bots", value: String(p.bots), color: VIZ.green },
                  { label: "Total", value: String(p.total), color: AXIS },
                ]}
              />
            );
          }}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: AXIS }} />
        <Line type="monotone" name="Humains" dataKey="humans" stroke={VIZ.violet} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" name="Bots" dataKey="bots" stroke={VIZ.green} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- Joins / leaves (diverging around zero) --------------------------------

function formatDay(day: string): string {
  const [, m, d] = day.split("-");
  return d && m ? `${d}/${m}` : day;
}

export function JoinLeaveChart({ data, height = 200 }: { data: MemberDeltaPoint[]; height?: number }) {
  if (data.length === 0) {
    return <EmptyChart height={height}>Aucune arrivée ni départ enregistré sur la période.</EmptyChart>;
  }
  // Leaves render below the zero baseline (position = the CVD-safe secondary cue).
  const rows = data.map((d) => ({ day: d.day, joins: d.joins, leaves: -d.leaves, rawLeaves: d.leaves }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barGap={2}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={formatDay} minTickGap={20} {...axisProps} />
        <YAxis allowDecimals={false} width={44} tickFormatter={(v: number) => String(Math.abs(v))} {...axisProps} />
        <ReferenceLine y={0} stroke={GRID} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as { day: string; joins: number; rawLeaves: number };
            return (
              <TooltipBox
                title={formatDay(p.day)}
                rows={[
                  { label: "Arrivées", value: `+${p.joins}`, color: VIZ.green },
                  { label: "Départs", value: `-${p.rawLeaves}`, color: VIZ.red },
                ]}
              />
            );
          }}
        />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: AXIS }} />
        <Bar name="Arrivées" dataKey="joins" fill={VIZ.green} radius={[3, 3, 0, 0]} />
        <Bar name="Départs" dataKey="leaves" fill={VIZ.red} radius={[0, 0, 3, 3]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Top channels (horizontal bars, single series) -------------------------

export interface NamedStat {
  name: string;
  value: number;
}

export function ChannelBarChart({
  data,
  color,
  unit,
  height = 280,
}: {
  data: NamedStat[];
  color: string;
  unit: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <EmptyChart height={height}>Aucune activité sur la période.</EmptyChart>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#9ba1b0", fontSize: 12 }} tickLine={false} axisLine={{ stroke: GRID }} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as NamedStat;
            return <TooltipBox title={p.name} rows={[{ label: unit, value: String(p.value), color }]} />;
          }}
        />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// --- Presence donut --------------------------------------------------------

const PRESENCE_SLICES: { key: keyof PresenceStatsDto; label: string; color: string }[] = [
  { key: "online", label: "En ligne", color: VIZ.green },
  { key: "idle", label: "Absent", color: VIZ.amber },
  { key: "dnd", label: "Ne pas déranger", color: VIZ.red },
  { key: "offline", label: "Hors ligne", color: VIZ.gray },
];

export function PresenceDonut({ data, height = 240 }: { data: PresenceStatsDto; height?: number }) {
  const slices = PRESENCE_SLICES.map((s) => ({ ...s, value: data[s.key] })).filter((s) => s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <EmptyChart height={height}>Aucune présence à afficher.</EmptyChart>;
  }
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <ResponsiveContainer width="100%" height={height} className="max-w-[220px]">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke={SURFACE} strokeWidth={2}>
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as { label: string; value: number; color: string };
              return (
                <TooltipBox
                  title={p.label}
                  rows={[{ label: `${Math.round((p.value / total) * 100)} %`, value: String(p.value), color: p.color }]}
                />
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:w-auto sm:grid-cols-1">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-zinc-400">{s.label}</span>
            <span className="ml-auto font-semibold text-zinc-100 tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
