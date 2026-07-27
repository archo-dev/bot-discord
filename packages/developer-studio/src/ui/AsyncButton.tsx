import { useRef, useState, type ReactNode } from "react";

type ButtonTone = "primary" | "danger" | "neutral";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-indigo-600 hover:bg-indigo-500 text-white",
  danger: "bg-red-700 hover:bg-red-600 text-white",
  neutral: "bg-zinc-700 hover:bg-zinc-600 text-white",
};

/**
 * Button wrapping an async action (Lot 4): shows a busy label, disables itself
 * for the duration and ignores re-entrant clicks (double-click safe). Errors
 * are swallowed here — callers surface them via toast/inline and decide whether
 * to keep the surrounding modal open.
 */
export function AsyncButton({
  onClick,
  children,
  busyLabel = "…",
  tone = "primary",
  disabled = false,
  className,
}: {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  busyLabel?: string;
  tone?: ButtonTone;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  // Synchronous re-entrancy guard: blocks a second click that fires before the
  // disabled state has re-rendered (true double-click safety).
  const runningRef = useRef(false);
  return (
    <button
      type="button"
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={async () => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBusy(true);
        try {
          await onClick();
        } catch {
          /* caller handles user-facing feedback */
        } finally {
          runningRef.current = false;
          setBusy(false);
        }
      }}
      className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${TONE[tone]} ${className ?? ""}`}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
