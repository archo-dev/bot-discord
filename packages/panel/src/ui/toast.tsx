import { useSyncExternalStore } from "react";

/*
 * Toasts « Nocturne 2 » (docs/design_system_v2.md §4.3).
 * Store module-level (pas de contexte) pour être déclenchable hors React,
 * notamment depuis le MutationCache global de TanStack Query.
 */

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** Action optionnelle (ex. « Annuler ») affichée à droite du message. */
  action?: { label: string; onClick: () => void };
}

const MAX_VISIBLE = 3;
const DURATION: Record<ToastTone, number> = { success: 4000, info: 4000, error: 8000 };

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  items = items.filter((i) => i.id !== id);
  emit();
}

function schedule(id: number, tone: ToastTone) {
  timers.set(
    id,
    setTimeout(() => dismiss(id), DURATION[tone]),
  );
}

function push(tone: ToastTone, message: string, action?: ToastItem["action"]) {
  const id = nextId++;
  items = [...items.slice(-(MAX_VISIBLE - 1)), { id, tone, message, action }];
  schedule(id, tone);
  emit();
  return id;
}

/** API globale : `toast.success("Panneau publié dans #support")`. */
export const toast = {
  success: (message: string, action?: ToastItem["action"]) => push("success", message, action),
  error: (message: string, action?: ToastItem["action"]) => push("error", message, action),
  info: (message: string, action?: ToastItem["action"]) => push("info", message, action),
  dismiss,
};

const toneStyles: Record<ToastTone, { icon: string; iconClass: string; live: "polite" | "assertive" }> = {
  success: { icon: "✓", iconClass: "bg-green-950 text-green-300", live: "polite" },
  error: { icon: "✕", iconClass: "bg-red-950 text-red-300", live: "assertive" },
  info: { icon: "i", iconClass: "bg-[--info-subtle] text-[--info-text]", live: "polite" },
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Conteneur à monter une fois (main.tsx). Pile en bas à droite, aria-live. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[--z-toast] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5"
    >
      {list.map((t) => {
        const s = toneStyles[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            onMouseEnter={() => {
              const timer = timers.get(t.id);
              if (timer) clearTimeout(timer);
            }}
            onMouseLeave={() => schedule(t.id, t.tone)}
            className="animate-toast-in pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-lg border border-zinc-800 bg-[--surface-2] p-3.5 shadow-[--shadow-md]"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.iconClass}`}
              aria-hidden
            >
              {s.icon}
            </span>
            <p className="min-w-0 flex-1 pt-0.5 text-sm text-zinc-100">{t.message}</p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 pt-0.5 text-sm font-semibold text-indigo-400 hover:text-indigo-300"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer la notification"
              className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-200"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden>
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
