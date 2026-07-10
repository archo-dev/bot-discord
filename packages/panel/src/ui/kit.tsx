import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

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
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm sm:p-6 ${className}`}>
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

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`} {...props} />;
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

/** Label + champ empilés (le libellé en éyebrow). */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
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
      className={`inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition ${
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

/* --- Onglets in-page (comme la page « Modération » de design2) --- */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="no-scrollbar -mx-5 mb-5 flex gap-1 overflow-x-auto border-b border-zinc-800 px-5 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
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

/* Ligne de retour de sauvegarde (succès/erreur) — réutilisée par les pages de réglages. */
export function SaveFeedback({ status }: { status: "idle" | "pending" | "success" | "error" }) {
  if (status === "success") return <span className="text-sm text-green-400">✓ Enregistré</span>;
  if (status === "error") return <span className="text-sm text-red-400">Échec de l'enregistrement</span>;
  return null;
}
