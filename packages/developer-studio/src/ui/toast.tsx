import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Lightweight toast system (Lot 4) — no external dependency. A stable actions
 * context (push/dismiss) so consumers never re-render when the queue changes;
 * a props-driven viewport with per-toast aria roles (status/alert) for SR.
 */
export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  /** Auto-dismiss delay in ms; defaults per tone. */
  duration?: number;
}

interface ToastActions {
  push: (input: ToastInput) => void;
  dismiss: (id: number) => void;
  success: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ActionsContext = createContext<ToastActions | null>(null);

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = (idRef.current += 1);
      setToasts((current) => [...current, { id, tone: input.tone, title: input.title, description: input.description }]);
      const duration = input.duration ?? DEFAULT_DURATION[input.tone];
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  const actions = useMemo<ToastActions>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ tone: "success", title, description }),
      info: (title, description) => push({ tone: "info", title, description }),
      warning: (title, description) => push({ tone: "warning", title, description }),
      error: (title, description) => push({ tone: "error", title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ActionsContext.Provider>
  );
}

export function useToast(): ToastActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const TONE_STYLE: Record<ToastTone, { border: string; icon: string; path: string }> = {
  success: { border: "border-l-green-500", icon: "text-green-400", path: "M20 6 9 17l-5-5" },
  info: { border: "border-l-indigo-500", icon: "text-indigo-400", path: "M12 16v-5m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" },
  warning: { border: "border-l-amber-500", icon: "text-amber-400", path: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01" },
  error: { border: "border-l-red-500", icon: "text-red-400", path: "M12 8v5m0 3h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" },
};

/** Stacked, responsive toast region. Errors/warnings announce assertively. */
export function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-stretch gap-2 p-4 sm:inset-x-auto sm:right-0 sm:max-w-sm">
      {toasts.map((t) => {
        const style = TONE_STYLE[t.tone];
        const assertive = t.tone === "error" || t.tone === "warning";
        return (
          <div
            key={t.id}
            role={assertive ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border border-zinc-700 border-l-4 ${style.border} bg-zinc-900 px-4 py-3 shadow-xl`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`mt-0.5 size-4 shrink-0 ${style.icon}`} aria-hidden="true">
              <path d={style.path} />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-zinc-100">{t.title}</div>
              {t.description && <div className="mt-0.5 text-xs text-zinc-400">{t.description}</div>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fermer la notification"
              className="-mr-1 shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
