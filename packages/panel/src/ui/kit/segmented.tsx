import type { KeyboardEvent, ReactNode } from "react";

/*
 * Kit Nocturne — SegmentedControl (Phase 2.2.a).
 * Contrôle segmenté à sélection unique. Remplace les groupes de boutons inline
 * (ex. Stats : plage de jours, messages/vocal). Pattern ARIA radiogroup + flèches.
 * Tokens canoniques : bordure --border-strong, actif --primary (cf. DESIGN_TOKENS.md).
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    if (i < 0) return;
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length]!;
    onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`inline-flex rounded-lg border border-(--border-strong) p-0.5 text-xs ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 font-medium transition duration-(--motion-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
              active ? "bg-(--primary) text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
