import { cloneElement, isValidElement, useId } from "react";
import type { InputHTMLAttributes, ReactElement, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Kit Nocturne — champs de formulaire : Input/Textarea/Select (5.7/5.8), Field, Toggle (5.6), Chip (5.4). */

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
