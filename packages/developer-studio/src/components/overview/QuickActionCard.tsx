import { NavIcon, type NavIconName } from "../NavIcon.js";

/** Shortcut tile to another Studio page. Only rendered by the parent when the
 * operator is allowed there (permission gating stays upstream). */
export function QuickActionCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: NavIconName;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/60"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-600/15 text-indigo-400">
        <NavIcon name={icon} className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-zinc-100">{title}</span>
        <span className="block truncate text-[11px] text-zinc-500">{subtitle}</span>
      </span>
    </button>
  );
}
