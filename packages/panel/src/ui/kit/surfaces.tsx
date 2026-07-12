import type { ReactNode } from "react";
import { Link } from "react-router";

/* Kit Nocturne — surfaces : Card (5.1), StatCard (5.2), InfoTile (v2 §4.10), InfoCard, tokens VizColor. */

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  pad = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `compact` = padding 16 px constant (densité M21) ; `default` = 20/24 px. */
  pad?: "default" | "compact";
}) {
  const padCls = pad === "compact" ? "p-4" : "p-5 sm:p-6";
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900 ${padCls} shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-zinc-100">{title}</h2>}
            {description && <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* Pastilles colorées des KPI/tuiles (design_system.md §data-viz). */
export type VizColor = "violet" | "blue" | "green" | "amber" | "red" | "gray";
const vizBg: Record<VizColor, string> = {
  violet: "bg-[#7C4DEE]",
  blue: "bg-[#3E7AFC]",
  green: "bg-[#1FC069]",
  amber: "bg-[#F0B114]",
  red: "bg-[#ED4B4B]",
  gray: "bg-[#4B5163]",
};

/* --- 5.2 Carte KPI (stat) --- */
export function StatCard({
  icon,
  color = "violet",
  value,
  label,
  hint,
}: {
  icon: ReactNode;
  color?: VizColor;
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${vizBg[color]}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[26px] font-bold leading-none tracking-tight text-zinc-100">{value}</div>
          <div className="mt-1 truncate text-[13px] text-zinc-400">{label}</div>
        </div>
      </div>
      {hint && <p className="mt-3 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/* --- v2 §4.10 InfoTile : tuile d'état/config (pendant de StatCard, valeur 15 px) --- */
export function InfoTile({
  icon,
  color = "gray",
  value,
  label,
  badge,
  to,
}: {
  icon: ReactNode;
  color?: VizColor;
  value: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  to?: string;
}) {
  const body = (
    <div className="flex items-center gap-3">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${vizBg[color]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-zinc-100">{value}</div>
        <div className="mt-0.5 truncate text-[13px] text-zinc-400">{label}</div>
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </div>
  );
  const cls = "block rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm";
  if (to) {
    return (
      <Link to={to} className={`${cls} transition hover:bg-(--state-hover)`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

/* --- Carte d'info « Bon à savoir » / « Astuce » (design2) --- */
export function InfoCard({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{children}</div>
      </div>
    </div>
  );
}
