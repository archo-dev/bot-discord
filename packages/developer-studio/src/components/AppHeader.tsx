import type { RefObject } from "react";
import type { StudioSessionInfo } from "@bot/shared";

/**
 * Top bar of the main column (Lot 2). Hosts the mobile hamburger (desktop uses
 * the fixed sidebar) and the always-accessible logout action. Operator identity
 * and environment now live in the sidebar footer.
 */
export function AppHeader({
  session,
  loggingOut,
  onLogout,
  onOpenMenu,
  menuButtonRef,
}: {
  session: StudioSessionInfo;
  loggingOut: boolean;
  onLogout: () => void;
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-3">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label="Ouvrir le menu"
        className="grid size-9 place-items-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-[18px]" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <span className="text-sm font-bold lg:hidden">Studio</span>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs text-zinc-500 sm:inline">
          {session.displayName ?? session.operatorId}
        </span>
        <button
          type="button"
          disabled={loggingOut}
          onClick={onLogout}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-50"
        >
          {loggingOut ? "Déconnexion…" : "Déconnexion"}
        </button>
      </div>
    </header>
  );
}
