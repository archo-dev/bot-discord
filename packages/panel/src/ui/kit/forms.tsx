import { cloneElement, isValidElement, useId } from "react";
import type { InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Kit Nocturne — champs de formulaire : Input/Textarea/Select (5.7/5.8), Field, Toggle (5.6), Chip (5.4). */

const fieldBase =
  "w-full rounded-lg border border-(--border-strong) bg-[rgba(8,10,18,0.72)] px-3.5 text-sm text-zinc-100 shadow-inner shadow-black/10 placeholder:text-zinc-500 transition duration-(--motion-fast) hover:border-zinc-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-55";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldBase} h-10 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldBase} min-h-[120px] resize-y py-2.5 leading-relaxed ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldBase} field-caret h-10 appearance-none pr-9 ${className}`} {...props}>
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
      <span className="mb-1.5 block text-body font-medium text-zinc-300">{label}</span>
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
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  ariaLabel?: string;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : "Activer ou désactiver cette option")}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
        checked ? "bg-indigo-600" : "bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
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
      className={`relative inline-flex h-8 items-center rounded-full border px-3.5 text-body font-medium transition before:absolute before:-inset-y-1 before:-inset-x-0.5 before:content-[''] ${
        selected
          ? "border-indigo-500/55 bg-indigo-950 text-indigo-200"
          : "border-(--border-strong) text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
