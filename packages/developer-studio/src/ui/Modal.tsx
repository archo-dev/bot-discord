import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Accessible modal base (Lot 4). role=dialog + aria-modal, labelled/described by
 * ids, focus moved inside on open and restored to the trigger on close, focus
 * trap on Tab, body scroll lock, and Escape-to-close (disabled while a critical
 * action is running via `closeOnEsc={false}`).
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  closeOnEsc = true,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  closeOnEsc?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const focusTimer = setTimeout(() => {
      (initialFocus?.current ?? focusable()[0] ?? panelRef.current)?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEsc) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, onClose, closeOnEsc, initialFocus]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={closeOnEsc ? onClose : undefined} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl outline-none"
      >
        {children}
      </div>
    </div>
  );
}
