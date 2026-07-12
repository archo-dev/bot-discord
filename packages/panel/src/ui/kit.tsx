import { cloneElement, isValidElement, useId } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Link } from "react-router";

/*
 * Kit de composants « Nocturne » — implémente docs/design_system.md §5.
 * Toutes les teintes passent par les échelles Tailwind remappées dans index.css.
 */

/* --- 5.1 Carte / panneau de section --- */
export function Card({
  title,
  description,
  action,
  children,
  className = "",
  pad = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `compact` = padding 16 px constant (densité M21) ; `default` = 20/24 px. */
  pad?: "default" | "compact";
}) {
  const padCls = pad === "compact" ? "p-4" : "p-5 sm:p-6";
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900 ${padCls} shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-zinc-100">{title}</h2>}
            {description && <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* --- 5.3 Boutons --- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-600",
  secondary: "border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  ghost: "text-zinc-300 hover:bg-zinc-800",
  danger: "bg-red-500 text-white hover:bg-red-400",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-[46px] px-5 text-sm",
};

/** Spinner 16 px pour l'état loading des boutons. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  // État loading (D.S. v2 §3) : spinner, label stable, bouton désactivé.
  return (
    <button
      className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/* --- 5.7 / 5.8 Champs --- */
const fieldBase =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldBase} h-11 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldBase} min-h-[120px] resize-y py-2.5 leading-relaxed ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldBase} h-11 appearance-none pr-9 ${className}`} {...props}>
      {children}
    </select>
  );
}

/** Label + champ empilés (le libellé en éyebrow).
 * `error` (D.S. v2 §3) : bordure danger sur le champ, message 12 px dessous,
 * `aria-invalid` + `aria-describedby` posés sur l'enfant unique. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  const errorId = useId();
  const child =
    error && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          "aria-invalid": true,
          "aria-describedby": errorId,
        })
      : children;
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-300">{label}</span>
      <span className={error ? "block [&_input]:border-red-500/70 [&_select]:border-red-500/70 [&_textarea]:border-red-500/70" : "block"}>
        {child}
      </span>
      {error ? (
        <span id={errorId} className="mt-1 block text-xs text-red-400">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
      )}
    </label>
  );
}

/* --- 5.6 Toggle (interrupteur) --- */
export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
        checked ? "bg-indigo-600" : "bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-zinc-200">{label}</div>
        {description && <div className="text-xs text-zinc-500">{description}</div>}
      </div>
      {sw}
    </div>
  );
}

/* --- 5.4 Chip / tag (multi-sélection) --- */
export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition before:absolute before:-inset-y-1 before:-inset-x-0.5 before:content-[''] ${
        selected
          ? "border-indigo-500/55 bg-indigo-950 text-indigo-200"
          : "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/* --- 5.5 Badge / pastille de statut --- */
type BadgeTone = "primary" | "success" | "warning" | "danger" | "neutral";
const badgeTones: Record<BadgeTone, string> = {
  primary: "bg-indigo-950 text-indigo-200",
  success: "bg-green-950 text-green-300",
  warning: "bg-amber-950 text-amber-200",
  danger: "bg-red-950 text-red-300",
  neutral: "bg-zinc-800 text-zinc-400",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

/* --- 5.2 Carte KPI (stat) --- */
export type VizColor = "violet" | "blue" | "green" | "amber" | "red" | "gray";
const vizBg: Record<VizColor, string> = {
  violet: "bg-[#7C4DEE]",
  blue: "bg-[#3E7AFC]",
  green: "bg-[#1FC069]",
  amber: "bg-[#F0B114]",
  red: "bg-[#ED4B4B]",
  gray: "bg-[#4B5163]",
};

export function StatCard({
  icon,
  color = "violet",
  value,
  label,
  hint,
}: {
  icon: ReactNode;
  color?: VizColor;
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${vizBg[color]}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[26px] font-bold leading-none tracking-tight text-zinc-100">{value}</div>
          <div className="mt-1 truncate text-[13px] text-zinc-400">{label}</div>
        </div>
      </div>
      {hint && <p className="mt-3 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/* --- v2 §4.10 InfoTile : tuile d'état/config (pendant de StatCard, valeur 15 px) --- */
export function InfoTile({
  icon,
  color = "gray",
  value,
  label,
  badge,
  to,
}: {
  icon: ReactNode;
  color?: VizColor;
  value: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  to?: string;
}) {
  const body = (
    <div className="flex items-center gap-3">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${vizBg[color]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-zinc-100">{value}</div>
        <div className="mt-0.5 truncate text-[13px] text-zinc-400">{label}</div>
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </div>
  );
  const cls = "block rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm";
  if (to) {
    return (
      <Link to={to} className={`${cls} transition hover:bg-(--state-hover)`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

/* --- Onglets in-page — pattern ARIA Tabs complet (D.S. v2 §3) : rôles + flèches ←/→ --- */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.id);
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`);
    el?.focus();
  };
  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className="no-scrollbar -mx-5 mb-5 flex gap-1 overflow-x-auto border-b border-zinc-800 px-5 sm:mx-0 sm:px-0"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab-id={t.id}
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
            active === t.id
              ? "border-indigo-500 font-semibold text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* --- Conteneur de table : défilement horizontal sur mobile --- */
export function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className={`w-full min-w-[34rem] text-sm ${className}`}>{children}</table>
    </div>
  );
}

/* --- Carte d'info « Bon à savoir » / « Astuce » (design2) --- */
export function InfoCard({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-100">{title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{children}</div>
      </div>
    </div>
  );
}

/* --- v2 §4.5 État vide --- */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-2) text-zinc-500" aria-hidden>
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --- v2 §5 Erreur de lecture : icône danger + message clair + « Réessayer » --- */
export function ErrorCard({
  message = "Impossible de charger les données.",
  onRetry,
}: {
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-zinc-800 bg-zinc-900 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-950 text-red-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-3 text-sm text-zinc-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

/* --- v2 §4.6 Bouton icône (aria-label obligatoire) --- */
export function IconButton({
  label,
  danger = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "hover:bg-red-950/50 hover:text-red-400" : "hover:bg-zinc-800 hover:text-zinc-200"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* --- v2 §4.7 Tooltip (CSS pur : survol + focus-within) --- */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-(--z-tooltip) mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-(--surface-3) px-2.5 py-1.5 text-xs text-zinc-100 opacity-0 shadow-(--shadow-md) transition-opacity delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100 group-focus-within/tt:delay-0"
      >
        {content}
      </span>
    </span>
  );
}

/* --- v2 §4.8 Pagination --- */
const pgArrow =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40";

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-[13px] text-zinc-400">
      <span style={{ fontFeatureSettings: '"tnum" 1' }}>
        {total != null && (
          <>
            <span className="font-semibold text-zinc-300">{total}</span> résultat{total > 1 ? "s" : ""} ·{" "}
          </>
        )}
        page {page}/{totalPages}
      </span>
      <button
        type="button"
        aria-label="Page précédente"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={pgArrow}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Page suivante"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className={pgArrow}
      >
        ›
      </button>
    </div>
  );
}
