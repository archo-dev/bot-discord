import { useId, type ReactNode } from "react";
import { AsyncButton } from "./AsyncButton.js";
import { Modal } from "./Modal.js";

/**
 * Confirmation dialog for level A (courant) and level B (sensitive) actions.
 * `tone="danger"` gives a red confirm button for sensitive/destructive actions.
 * The caller's `onConfirm` performs the work and closes the dialog only on real
 * success (it should leave it open on failure and surface a toast).
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Annuler",
  busyLabel = "…",
  tone = "default",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Optional impact summary shown above the actions. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const titleId = useId();
  const descId = useId();
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} describedBy={description ? descId : undefined}>
      <h2 id={titleId} className="text-base font-semibold text-zinc-100">
        {title}
      </h2>
      {description && (
        <p id={descId} className="mt-1.5 text-sm text-zinc-400">
          {description}
        </p>
      )}
      {children && <div className="mt-3">{children}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {cancelLabel}
        </button>
        <AsyncButton onClick={onConfirm} busyLabel={busyLabel} tone={tone === "danger" ? "danger" : "primary"}>
          {confirmLabel}
        </AsyncButton>
      </div>
    </Modal>
  );
}
