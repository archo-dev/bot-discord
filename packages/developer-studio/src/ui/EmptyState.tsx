import type { ReactNode } from "react";
import { NavIcon, type NavIconName } from "../components/NavIcon.js";

/** Reusable empty state (Lot 4). `action` is rendered as-is; the caller only
 * passes one when the operator is actually allowed to perform it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: NavIconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-zinc-800/70 text-zinc-500">
        <NavIcon name={icon} className="size-6" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-zinc-200">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
