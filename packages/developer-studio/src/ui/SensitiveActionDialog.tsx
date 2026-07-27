import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AsyncButton } from "./AsyncButton.js";
import { InlineNotice } from "./InlineNotice.js";
import { Modal } from "./Modal.js";

/**
 * Critical action dialog (level C, Lot 4): requires typing an exact confirmation
 * word before the (red) confirm button enables, optionally shows a step-up
 * re-auth notice, and disables Escape/scrim close while the action runs. The
 * confirm input is reset every time the dialog opens.
 */
export function SensitiveActionDialog({
  open,
  onClose,
  title,
  description,
  impact,
  confirmWord,
  confirmLabel,
  onConfirm,
  stepUpRequired = false,
  onStepUp,
  locked = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  impact?: ReactNode;
  confirmWord: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | unknown;
  stepUpRequired?: boolean;
  onStepUp?: () => void;
  /** When true, the action is mid-flight: block Escape/scrim close. */
  locked?: boolean;
}) {
  const [value, setValue] = useState("");
  const titleId = useId();
  const descId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descId}
      initialFocus={inputRef}
      closeOnEsc={!locked}
    >
      <h2 id={titleId} className="text-base font-semibold text-zinc-100">
        {title}
      </h2>
      <p id={descId} className="mt-1.5 text-sm text-zinc-400">
        {description}
      </p>
      {impact && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{impact}</div>
      )}
      {stepUpRequired && (
        <div className="mt-3">
          <InlineNotice
            tone="warning"
            action={
              onStepUp ? (
                <button type="button" onClick={onStepUp} className="font-semibold underline">
                  Ré-authentifier
                </button>
              ) : undefined
            }
          >
            Ré-authentification requise avant l'exécution.
          </InlineNotice>
        </div>
      )}
      <label className="mt-4 block text-sm text-zinc-300">
        Saisissez <b className="font-mono text-zinc-100">{confirmWord}</b> pour confirmer
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={confirmWord}
          className="mt-1.5 w-full rounded bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={locked}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Annuler
        </button>
        <AsyncButton onClick={onConfirm} disabled={value !== confirmWord} tone="danger" busyLabel="Exécution…">
          {confirmLabel}
        </AsyncButton>
      </div>
    </Modal>
  );
}
