import type { TicketPanelPreviewModel } from "../../lib/ticket-preview.js";

export function TicketPanelPreview({ preview }: { preview: TicketPanelPreviewModel }) {
  return (
    <figure
      aria-label="Aperçu indicatif du panneau d’ouverture des tickets"
      className="overflow-hidden rounded-xl border border-zinc-700 bg-[#111214] shadow-xl"
    >
      <figcaption className="flex items-center justify-between border-b border-white/5 bg-zinc-900/80 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-300">Démonstration locale</span>
        <span className="text-[10px] text-zinc-500">Aucun appel réseau</span>
      </figcaption>
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white" aria-hidden>
            A
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-100">Archodev</span>
              <span className="rounded bg-indigo-500 px-1 py-0.5 text-[8px] font-bold text-white">BOT</span>
            </div>
            <div className="mt-2 min-w-0 rounded border-l-4 border-indigo-500 bg-zinc-900/80 px-3 py-3">
              <p className={`break-words text-sm font-semibold ${preview.emptyTitle ? "italic text-zinc-500" : "text-zinc-100"}`}>
                🎫 {preview.title}
              </p>
              <p className={`mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed ${preview.emptyDescription ? "italic text-zinc-500" : "text-zinc-300"}`}>
                {preview.description}
              </p>
            </div>
            {preview.opener.kind === "select" ? (
              <div className="mt-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5">
                <p className="text-xs text-zinc-300">{preview.opener.label}</p>
                <ul className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
                  {preview.opener.categories.map((category) => (
                    <li key={category.id} className="min-w-0 text-[11px] text-zinc-400">
                      <span className="font-medium text-zinc-200">{category.emoji} {category.label}</span>
                      {category.description && <span className="block break-words text-zinc-500">{category.description}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <button type="button" disabled className="mt-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white opacity-90">
                🎫 {preview.opener.label}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="border-t border-white/5 bg-zinc-950/60 px-3 py-2.5">
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Aperçu indicatif du brouillon. L’état ouvert ou fermé d’un ticket réel n’est pas simulé ici.
        </p>
      </div>
    </figure>
  );
}
