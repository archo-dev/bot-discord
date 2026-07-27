import { NavIcon, type NavIconName } from "../NavIcon.js";

/** KPI card. Becomes an accessible button when `onClick` is provided (navigates
 * to the matching page). Renders only real values — pass « — » + a hint when a
 * datum is genuinely unavailable rather than fabricating a number. */
export function StatCard({
  icon,
  value,
  label,
  hint,
  onClick,
}: {
  icon: NavIconName;
  value: string | number;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="grid size-8 place-items-center rounded-lg bg-indigo-600/15 text-indigo-400">
          <NavIcon name={icon} className="size-[18px]" />
        </span>
        {onClick && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 text-zinc-600" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        )}
      </div>
      <div className="mt-3 text-2xl font-bold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-400">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>}
    </>
  );

  const base = "rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-left";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full transition-colors hover:border-zinc-700 hover:bg-zinc-800/60`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}
