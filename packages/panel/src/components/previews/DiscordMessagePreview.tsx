import type { RolesPreview } from "../../lib/roles-preview.js";
import { Icon } from "../../ui/icons.js";

const BUTTON_STYLES: Record<number, string> = {
  1: "border-[#5865f2] bg-[#5865f2] text-white",
  2: "border-[#4e5058] bg-[#4e5058] text-white",
  3: "border-[#248046] bg-[#248046] text-white",
  4: "border-[#da373c] bg-[#da373c] text-white",
};

export function DiscordMessagePreview({
  preview,
  author = "Bot du serveur",
}: {
  preview: RolesPreview;
  author?: string;
}) {
  return (
    <div
      aria-label="Aperçu indicatif du message Discord"
      className="overflow-hidden rounded-xl border border-zinc-800 bg-[#1e1f22] shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between border-b border-white/5 bg-[#2b2d31] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Aperçu indicatif</span>
        <span className="text-[10px] text-zinc-500">Discord peut ajuster le rendu</span>
      </div>

      <div className="min-w-0 p-3 sm:p-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white" aria-hidden>
            A
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-white">{author}</span>
              <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[8px] font-bold uppercase text-white">Bot</span>
              <span className="text-[10px] text-[#949ba4]">Aujourd’hui</span>
            </div>

            {preview.empty ? (
              <div className="mt-3 rounded-lg border border-dashed border-[#4e5058] px-3 py-8 text-center">
                <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-[#2b2d31] text-[#949ba4]" aria-hidden><Icon.tag /></span>
                <p className="mt-2 text-xs font-semibold text-[#dbdee1]">Aucun contenu configuré</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#949ba4]">Le titre, la description et les boutons apparaîtront ici.</p>
              </div>
            ) : (
              <>
                <div className="mt-2 min-w-0 overflow-hidden rounded-r border-l-4 border-[#5865f2] bg-[#2b2d31] px-3 py-2.5">
                  {preview.title.trim() && (
                    <p className="break-words text-sm font-semibold leading-snug text-[#f2f3f5]">{preview.title}</p>
                  )}
                  {preview.description.trim() && (
                    <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[#dbdee1]">
                      {preview.description}
                    </p>
                  )}
                  <p className="mt-2 text-[9px] text-[#949ba4]">Archodev · aperçu local</p>
                </div>
                {preview.buttons.length > 0 && (
                  <div aria-label="Boutons du message" className="mt-2 flex flex-wrap gap-1.5">
                    {preview.buttons.map((button, index) => (
                      <span
                        key={`${button.roleId}-${index}`}
                        title={`Attribue ou retire le rôle ${button.roleName}`}
                        className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${BUTTON_STYLES[button.style] ?? BUTTON_STYLES[2]}`}
                      >
                        {button.emoji && <span aria-hidden>{button.emoji}</span>}
                        <span className="min-w-0 break-words">{button.label || "Bouton sans libellé"}</span>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {preview.response && (
          <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/8 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">Réponse privée indicative</p>
            <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-300">{preview.response}</p>
          </div>
        )}
      </div>
    </div>
  );
}
