import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

/* Kit Nocturne — boutons : Button (5.3), Spinner, IconButton (v2 §4.6). */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-lg font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] duration-(--motion-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:translate-y-0";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-(--shadow-primary) hover:from-indigo-400 hover:to-indigo-500",
  secondary: "border border-zinc-700 bg-(--surface-2) text-zinc-100 hover:border-zinc-600 hover:bg-(--surface-3)",
  ghost: "shadow-none text-zinc-300 hover:bg-(--state-hover) hover:text-zinc-100",
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

/* --- v2 §4.6 Bouton icône (aria-label obligatoire) --- */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }>(function IconButton({
  label,
  danger = false,
  className = "",
  children,
  ...props
}, ref) {
  return (
    <button
      type="button"
      ref={ref}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition duration-(--motion-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "hover:bg-red-950/50 hover:text-red-400" : "hover:bg-zinc-800 hover:text-zinc-200"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
