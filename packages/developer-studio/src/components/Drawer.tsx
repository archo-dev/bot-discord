import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Mobile navigation drawer (Lot 2). Slides in from the left over a scrim.
 * Behaviours required by the brief:
 *   - scrim click closes;
 *   - Escape closes;
 *   - focus moves into the drawer on open and returns to the trigger on close;
 *   - focus is trapped inside while open (Tab cycles within the panel).
 * Hidden entirely on desktop (lg:) where the fixed sidebar is used instead.
 */
export function Drawer({
  open,
  onClose,
  returnFocusRef,
  focusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Element focus returns to on close (the hamburger). */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Preferred element to focus on open (e.g. the active nav entry). */
  focusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = returnFocusRef.current;
    // Move focus into the drawer once painted.
    const focusTarget = focusRef.current ?? panelRef.current;
    focusTarget?.focus();

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (activeEl === first || activeEl === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever opened the drawer.
      trigger?.focus();
    };
  }, [open, onClose, returnFocusRef, focusRef]);

  return (
    <div className="lg:hidden" aria-hidden={!open}>
      {/* Scrim */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-zinc-800 bg-zinc-950 shadow-2xl outline-none transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
