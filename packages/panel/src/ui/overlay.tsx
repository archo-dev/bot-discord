import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./kit.js";

/*
 * Overlays « Nocturne 2 » (docs/design_system_v2.md §4.1).
 * Modal générique + variante de confirmation destructive.
 * Focus trap, Échap, clic backdrop, restitution du focus au déclencheur.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  placement = "center",
  /** Bloque Échap/backdrop pendant une mutation en cours. */
  locked = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: "md" | "2xl";
  placement?: "center" | "right";
  locked?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus initial : premier élément focusable (l'action la moins destructive est placée en premier)
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    // Scroll de la page verrouillé
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Focus trap
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div
      className={`animate-overlay-in fixed inset-0 z-(--z-modal) flex bg-[rgba(6,7,14,0.72)] ${placement === "right" ? "justify-end" : "items-center justify-center p-4 sm:p-6"}`}
      onClick={() => !locked && onClose()}
      aria-hidden={false}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`animate-panel-in w-full overflow-auto border border-zinc-800 bg-zinc-900 shadow-(--shadow-lg) outline-none ${
          placement === "right"
            ? "h-full max-w-lg border-y-0 border-r-0 p-4 sm:p-5"
            : `max-h-[85vh] rounded-2xl p-5 sm:p-6 ${size === "2xl" ? "max-w-2xl" : "max-w-md"}`
        }`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label="Fermer"
            className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5 fill-current" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Détail secondaire ancré à droite, avec le même contrat clavier que Modal. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  return <Modal open={open} onClose={onClose} title={title} placement="right">{children}</Modal>;
}

/**
 * Confirmation destructive (D.S. v2 §4.1) — remplace tous les confirm() natifs.
 * `subject` : le nom de l'objet supprimé, mis en évidence.
 * `consequence` : ce qui est irréversible, dit explicitement.
 */
export function ConfirmModal({
  open,
  title,
  subject,
  consequence,
  confirmLabel = "Supprimer",
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  subject: ReactNode;
  consequence?: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} locked={loading}>
      <div className="flex gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-950 text-red-400"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M9 3.75A.75.75 0 0 1 9.75 3h4.5a.75.75 0 0 1 .75.75V5h4.25a.75.75 0 0 1 0 1.5h-.802l-.86 12.048A2.25 2.25 0 0 1 15.344 20.5H8.656a2.25 2.25 0 0 1-2.244-1.952L5.552 6.5H4.75a.75.75 0 0 1 0-1.5H9V3.75Zm1.5 1.25h3V4.5h-3V5Zm-2.94 1.5.845 11.842a.75.75 0 0 0 .748.658h6.688a.75.75 0 0 0 .748-.658L17.44 6.5H7.56Zm2.69 2.25a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75Zm3.5 0a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75Z" />
          </svg>
        </span>
        <div className="min-w-0 text-sm leading-relaxed text-zinc-400">
          <p>{subject}</p>
          {consequence && <p className="mt-1.5 text-[13px] text-zinc-500">{consequence}</p>}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
