import type { FormState } from "../../pages/command-editor/logic.js";

const DEMO_VALUES: Readonly<Record<string, string>> = {
  "{mention}": "@Camille (démo)",
  "{user}": "Camille (démo)",
  "{user.id}": "123456789012345678 (démo)",
  "{server}": "Atelier Archodev (démo)",
  "{membercount}": "1 234 (démo)",
  "{channel}": "#général (démo)",
};

const renderDemo = (value: string) =>
  Object.entries(DEMO_VALUES).reduce(
    (rendered, [variable, replacement]) => rendered.split(variable).join(replacement),
    value,
  );

export function CommandPreview({ form }: { form: FormState }) {
  const content = renderDemo(form.replyContent);
  const embedTitle = renderDemo(form.embedTitle);
  const embedDescription = renderDemo(form.embedDescription);
  const empty = !content.trim() && !(form.embedEnabled && (embedTitle.trim() || embedDescription.trim()));
  return (
    <section
      aria-label="Aperçu indicatif de la réponse Discord"
      className="overflow-hidden rounded-xl border border-zinc-800 bg-[#1e1f22]"
    >
      <div className="flex items-center justify-between border-b border-white/5 bg-[#2b2d31] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Démonstration locale</span>
        <span className="text-[10px] text-zinc-500">{form.replyEphemeral ? "Éphémère" : "Visible dans le salon"}</span>
      </div>
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white" aria-hidden>A</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white">Bot du serveur <span className="ml-1 rounded bg-[#5865f2] px-1 py-0.5 text-[8px] uppercase">Bot</span></p>
            {empty ? (
              <p className="mt-2 rounded-lg border border-dashed border-[#4e5058] px-3 py-5 text-center text-[11px] text-[#949ba4]">
                Aucune réponse Discord configurée
              </p>
            ) : (
              <>
                {content && <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[#dbdee1]">{content}</p>}
                {form.embedEnabled && (embedTitle || embedDescription) && (
                  <div className="mt-2 rounded-r border-l-4 bg-[#2b2d31] px-3 py-2.5" style={{ borderColor: form.embedColor }}>
                    {embedTitle && <p className="break-words text-xs font-semibold text-white">{embedTitle}</p>}
                    {embedDescription && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#dbdee1]">{embedDescription}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
          Les remplacements visibles sont des valeurs de démonstration. Aucun appel réseau n’est effectué.
        </p>
      </div>
    </section>
  );
}
