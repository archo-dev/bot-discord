import { toast } from "./toast.js";

/*
 * UserCell « Nocturne 2 » (docs/design_system_v2.md §4.11) — mode dégradé :
 * pas encore d'endpoint de résolution, on affiche « Utilisateur 2325…89 »
 * (ID abrégé, complet au survol, copié au clic). Le composant s'enrichira
 * (avatar + pseudo) quand le Worker exposera la résolution des membres.
 */

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-2)}` : id;
}

function copyId(id: string) {
  void navigator.clipboard.writeText(id).then(
    () => toast.info("ID copié"),
    () => toast.error("Impossible de copier l'ID"),
  );
}

export function UserCell({ userId }: { userId: string }) {
  if (userId === "system" || userId === "automod") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-zinc-300">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[--surface-3] text-zinc-400"
          aria-hidden
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="8" width="14" height="11" rx="2" />
            <path d="M12 4v4" />
            <circle cx="12" cy="3" r="1" fill="currentColor" />
            <circle cx="9.5" cy="13" r="0.5" fill="currentColor" />
            <circle cx="14.5" cy="13" r="0.5" fill="currentColor" />
          </svg>
        </span>
        Système
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => copyId(userId)}
      title={`${userId} — cliquer pour copier`}
      className="inline-flex items-center gap-2 rounded-md text-sm text-zinc-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[--surface-3] text-[10px] font-bold text-zinc-400"
        aria-hidden
      >
        {userId.slice(-2)}
      </span>
      <span className="font-medium">Utilisateur {shortId(userId)}</span>
    </button>
  );
}
