import type { ReactNode } from "react";

function WorkspaceZone({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <header className="mb-3 px-1">
        <h2 id={`${id}-title`} className="font-display text-[15px] font-semibold text-zinc-100">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>
      </header>
      {children}
    </section>
  );
}

export function ModuleWorkspace({
  configuration,
  preview,
  context,
  configurationDescription = "Composez le message et ses boutons.",
  previewDescription = "Rendu indicatif, mis à jour depuis le brouillon local.",
  contextDescription = "État réel, prérequis et messages déjà publiés.",
}: {
  configuration: ReactNode;
  preview: ReactNode;
  context: ReactNode;
  configurationDescription?: string;
  previewDescription?: string;
  contextDescription?: string;
}) {
  return (
    <div data-module-workspace className="grid min-w-0 items-start gap-4 lg:grid-cols-12">
      <WorkspaceZone
        id="module-configuration"
        title="Configuration"
        description={configurationDescription}
        className="min-w-0 lg:col-span-7 xl:col-span-6"
      >
        {configuration}
      </WorkspaceZone>
      <WorkspaceZone
        id="module-preview"
        title="Aperçu Discord"
        description={previewDescription}
        className="min-w-0 lg:sticky lg:top-20 lg:col-span-5 xl:col-span-3"
      >
        {preview}
      </WorkspaceZone>
      <WorkspaceZone
        id="module-publication"
        title="Contexte et publication"
        description={contextDescription}
        className="min-w-0 lg:col-span-12 xl:col-span-3"
      >
        {context}
      </WorkspaceZone>
    </div>
  );
}
