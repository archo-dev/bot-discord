import type { ReactNode } from "react";

/** Carte repliable pour les réglages et informations consultés occasionnellement. */
export function DisclosureCard({
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
      className="group rounded-xl border border-zinc-800/90 bg-[linear-gradient(150deg,rgba(29,26,40,0.96),rgba(22,20,31,0.96))] shadow-(--shadow-card)"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition hover:bg-(--state-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/70 sm:px-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-zinc-100">{title}</h2>
          {description && <p className="mt-0.5 truncate text-xs text-zinc-500 group-open:whitespace-normal">{description}</p>}
        </div>
        <span className="text-zinc-500 transition-transform duration-(--motion-base) group-open:rotate-180" aria-hidden>⌄</span>
      </summary>
      <div className="border-t border-zinc-800/80 p-4 sm:p-5">{children}</div>
    </details>
  );
}
