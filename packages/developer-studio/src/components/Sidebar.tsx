import type { StudioSessionInfo } from "@bot/shared";
import { NavIcon } from "./NavIcon.js";
import type { NavSection } from "../lib/nav.js";
import type { Tab } from "../lib/nav.js";

/**
 * Sidebar navigation content (Lot 2). Presentational and permission-agnostic:
 * it renders whatever `sections` it is handed. App does the can(...) filtering
 * upstream, so nothing here can widen access. Reused verbatim as the desktop
 * fixed sidebar and as the body of the mobile drawer.
 */
export function Sidebar({
  sections,
  current,
  onSelect,
  session,
  supportCount,
  itemRef,
}: {
  sections: NavSection[];
  current: Tab;
  onSelect: (tab: Tab) => void;
  session: StudioSessionInfo;
  supportCount: number | null;
  /** Attaches to the active entry so the drawer can focus it on open. */
  itemRef?: (el: HTMLButtonElement | null) => void;
}) {
  const envLabel = import.meta.env.MODE === "staging" ? "Staging" : "Production";
  const roleLabel = session.isOwner ? "Propriétaire" : "Opérateur";
  const who = session.displayName ?? session.operatorId;
  const initial = (who?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 pb-3.5">
        <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-sm font-extrabold text-zinc-950">
          A
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold text-zinc-100">Studio</span>
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
            Console d'exploitation
          </span>
        </span>
      </div>

      {/* Groups */}
      {sections.map((section, i) => (
        <div key={section.label ?? `top-${i}`} className={section.label ? "mt-2.5" : undefined}>
          {section.label && (
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {section.label}
            </div>
          )}
          {section.items.map((item) => {
            const active = item.id === current;
            const badge =
              item.id === "support" && supportCount != null && supportCount > 0 ? supportCount : null;
            return (
              <button
                key={item.id}
                type="button"
                ref={active ? itemRef : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-indigo-500/30 bg-indigo-600/15 text-zinc-100"
                    : "border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                <NavIcon
                  name={item.icon}
                  className={`size-[17px] shrink-0 ${active ? "text-indigo-400" : "text-zinc-500"}`}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {badge != null && (
                  <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* Footer: operator identity + environment */}
      <div className="mt-auto flex items-center gap-2.5 border-t border-zinc-800 pt-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs text-zinc-400">
          {initial}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-xs font-semibold text-zinc-100">{who}</span>
          <span className="block truncate text-[11px] text-zinc-500">
            {roleLabel} · {envLabel}
          </span>
        </span>
      </div>
    </div>
  );
}
