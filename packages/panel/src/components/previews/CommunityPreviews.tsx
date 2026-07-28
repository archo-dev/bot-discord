import type {
  StarboardPreviewModel,
  WelcomeMessagePreviewModel,
} from "../../lib/community-preview.js";
import { Icon } from "../../ui/icons.js";

export function WelcomeMessagePreview({
  preview,
}: {
  preview: WelcomeMessagePreviewModel;
}) {
  const label = preview.kind === "welcome" ? "Message de bienvenue" : "Message de départ";
  return (
    <section
      aria-label={`Aperçu indicatif — ${label}`}
      className="overflow-hidden rounded-xl border border-zinc-800 bg-[#1e1f22] shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between border-b border-white/5 bg-[#2b2d31] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{label}</span>
        <span className={`text-[10px] font-medium ${preview.enabled ? "text-emerald-300" : "text-zinc-500"}`}>
          {preview.enabled ? "Activé" : "Désactivé"}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white" aria-hidden>A</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-white">Bot du serveur</span>
              <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[8px] font-bold uppercase text-white">Bot</span>
              <span className="text-[9px] text-[#949ba4]">démonstration</span>
            </div>
            {preview.empty ? (
              <div className="mt-2 rounded-lg border border-dashed border-[#4e5058] px-3 py-6 text-center">
                <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-[#2b2d31] text-[#949ba4]" aria-hidden><Icon.wave /></span>
                <p className="mt-2 text-[11px] font-semibold text-[#dbdee1]">Aucun message configuré</p>
              </div>
            ) : (
              <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[#dbdee1]">
                {preview.rendered}
              </p>
            )}
          </div>
        </div>
        {preview.replacedVariables.length > 0 && (
          <p className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/8 px-2.5 py-2 text-[10px] leading-relaxed text-indigo-200">
            Valeurs de démonstration remplacées localement : {preview.replacedVariables.join(", ")}.
          </p>
        )}
        {!preview.enabled && (
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">Le message reste prévisualisable, mais aucun envoi n’aura lieu tant qu’il est désactivé.</p>
        )}
      </div>
    </section>
  );
}

export function StarboardMessagePreview({
  preview,
}: {
  preview: StarboardPreviewModel;
}) {
  return (
    <section
      aria-label="Aperçu indicatif d’un message Starboard"
      className="overflow-hidden rounded-xl border border-zinc-800 bg-[#1e1f22] shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between border-b border-white/5 bg-[#2b2d31] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Démonstration locale</span>
        <span className={`text-[10px] font-medium ${preview.enabled ? "text-emerald-300" : "text-zinc-500"}`}>
          {preview.enabled ? "Activé" : "Désactivé"}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-amber-300">{preview.reactionLabel}</span>
          <span className="truncate text-[#949ba4]">#général · salon source fictif</span>
        </div>
        <div className="mt-2 rounded-r border-l-4 border-amber-400 bg-[#2b2d31] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white" aria-hidden>C</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#f2f3f5]">Camille · auteur de démonstration</p>
              <p className="text-[9px] text-[#949ba4]">Aujourd’hui</p>
            </div>
          </div>
          <p className="mt-2 break-words text-xs leading-relaxed text-[#dbdee1]">
            Exemple local d’un message ayant atteint le seuil configuré. Aucun message réel du serveur n’est chargé.
          </p>
          <div aria-label="Pièce jointe simulée" className="mt-2 flex h-24 items-center justify-center rounded-lg border border-white/5 bg-[linear-gradient(135deg,#3b3158,#202832)]">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Pièce jointe simulée</span>
          </div>
          <p className="mt-2 text-[9px] text-[#949ba4]">Destination : {preview.targetChannel ? `#${preview.targetChannel}` : "non configurée"}</p>
        </div>
        {!preview.configured && (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-700 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500">
            Sélectionnez un salon et un emoji pour compléter la configuration.
          </p>
        )}
      </div>
    </section>
  );
}
