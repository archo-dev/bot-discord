import type { ReactNode } from "react";

export function EditorWorkspace({
  main,
  rail,
  mainDescription = "Configurez le comportement dans l’ordre d’exécution.",
  railDescription = "Résumé local, état réel et prérequis.",
}: {
  main: ReactNode;
  rail: ReactNode;
  mainDescription?: string;
  railDescription?: string;
}) {
  return (
    <div data-editor-workspace className="grid min-w-0 items-start gap-4 lg:grid-cols-12">
      <section aria-labelledby="editor-main-title" className="min-w-0 lg:col-span-8 xl:col-span-9">
        <header className="mb-3 px-1">
          <h2 id="editor-main-title" className="font-display text-[15px] font-semibold text-zinc-100">Éditeur</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{mainDescription}</p>
        </header>
        {main}
      </section>
      <aside aria-labelledby="editor-context-title" className="min-w-0 lg:sticky lg:top-20 lg:col-span-4 xl:col-span-3">
        <header className="mb-3 px-1">
          <h2 id="editor-context-title" className="font-display text-[15px] font-semibold text-zinc-100">Résumé et contexte</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{railDescription}</p>
        </header>
        {rail}
      </aside>
    </div>
  );
}

export function FlowSummary({
  sentence,
  steps,
  label = "Résumé local",
}: {
  sentence: string;
  steps?: readonly string[];
  label?: string;
}) {
  return (
    <section aria-label={label} className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-300">{label}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-zinc-100">{sentence}</p>
      {steps && steps.length > 0 && (
        <ol className="mt-3 space-y-1.5 border-t border-indigo-400/15 pt-3">
          {steps.map((step, index) => (
            <li key={`${index}-${step}`} className="flex gap-2 text-xs leading-relaxed text-zinc-400">
              <span className="font-semibold tabular-nums text-indigo-300">{index + 1}.</span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
        Projection du brouillon local uniquement — elle ne simule pas l’exécution Discord.
      </p>
    </section>
  );
}
