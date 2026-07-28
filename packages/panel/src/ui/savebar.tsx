import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { Button, Spinner } from "./kit.js";
import { Modal } from "./overlay.js";
import { useCanWrite } from "../lib/access.js";

/*
 * SaveBar « Nocturne 2 » (docs/design_system_v2.md §4.9).
 * Barre collante qui apparaît dès que le formulaire diverge de l'état serveur.
 * Remplace le bouton « Enregistrer » en bas de page.
 */

/**
 * Dirty state par comparaison structurelle avec l'état serveur.
 * `initial` = la même projection que celle qui initialise le formulaire
 * (undefined tant que la requête n'a pas répondu).
 * Pose aussi la garde beforeunload quand le formulaire est sale.
 */
export function useDirty<T>(current: T, initial: T | undefined): boolean {
  const dirty = initial !== undefined && JSON.stringify(current) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return dirty;
}

export function SaveBar({
  dirty,
  status,
  onSave,
  onReset,
  errorMessage = "Échec de l'enregistrement — réessayez.",
  actionLabel = "Enregistrer",
  pendingLabel = "Enregistrement en cours",
  dirtyLabel = "Modifications non enregistrées",
  successLabel = "✓ Enregistré",
  cleanLabel,
  readOnlyLabel = "Lecture seule — vos modifications ne peuvent pas être enregistrées",
  showWhenClean = false,
  actionDisabled = false,
}: {
  dirty: boolean;
  status: "idle" | "pending" | "success" | "error";
  onSave: () => void;
  onReset: () => void;
  errorMessage?: string;
  actionLabel?: string;
  pendingLabel?: string;
  dirtyLabel?: string;
  successLabel?: string;
  cleanLabel?: string;
  readOnlyLabel?: string;
  showWhenClean?: boolean;
  actionDisabled?: boolean;
}) {
  // Lecture seule (M15) : les champs sont désactivés en amont (fieldset), donc
  // dirty ne devrait jamais passer à true — ceinture et bretelles : si ça
  // arrive quand même, on n'offre que « Réinitialiser », jamais « Enregistrer ».
  const canWrite = useCanWrite();
  // Après un enregistrement réussi (le refetch resynchronise le formulaire → dirty
  // repasse à false), on affiche « ✓ Enregistré » 1,5 s avant de disparaître.
  const [justSaved, setJustSaved] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev === "pending" && status === "success") {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 1500);
      return () => clearTimeout(t);
    }
  }, [status]);
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  // Garde de navigation interne (D.S. v2 §4.9) : dirty + tentative de départ
  // ⇒ modale « Quitter sans enregistrer ? ». Le beforeunload de useDirty couvre
  // la fermeture d'onglet ; ce blocker couvre les navigations react-router.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    // Formulaire redevenu propre (enregistré/réinitialisé) pendant le blocage : laisser passer
    if (blocker.state === "blocked" && !dirty) blocker.proceed?.();
  }, [blocker, dirty]);

  if (!dirty && !justSaved && !showWhenClean) {
    return null;
  }

  return (
    <div
      className="sticky z-(--z-sticky) mt-6"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div
        data-savebar
        role={status === "error" ? "alert" : undefined}
        aria-live={status === "error" ? "assertive" : "off"}
        className={`animate-savebar-in flex min-w-0 flex-wrap items-center gap-3 rounded-xl border bg-(--surface-2) px-4 py-3 shadow-(--shadow-md) ${
          status === "error" ? "border-red-900/70" : "border-zinc-700"
        }`}
      >
        <span className="sr-only" aria-live="polite">
          {status === "error" ? "" : status === "pending" ? pendingLabel : justSaved ? successLabel : dirty ? dirtyLabel : cleanLabel}
        </span>
        {justSaved && !dirty ? (
          <span className="text-sm font-semibold text-green-400">{successLabel}</span>
        ) : (
          <>
            <span className="min-w-0 break-words text-sm font-semibold text-zinc-100">
              {!canWrite ? (
                readOnlyLabel
              ) : status === "pending" ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5" /> {pendingLabel}
                </span>
              ) : !dirty && cleanLabel ? (
                cleanLabel
              ) : (
                dirtyLabel
              )}
            </span>
            {status === "error" && <span className="min-w-0 break-words text-[13px] leading-relaxed text-red-400">{errorMessage}</span>}
            <span className="ml-auto flex w-full flex-col gap-2 min-[360px]:flex-row sm:w-auto">
              {dirty && (
                <Button className="w-full min-[360px]:flex-1 sm:w-auto sm:flex-none" variant="ghost" size="sm" onClick={onReset} disabled={status === "pending"}>
                  Réinitialiser
                </Button>
              )}
              {canWrite && (
                <Button className="w-full min-[360px]:flex-1 sm:w-auto sm:flex-none" size="sm" onClick={onSave} loading={status === "pending"} disabled={actionDisabled || status === "pending"}>
                  {actionLabel}
                </Button>
              )}
            </span>
          </>
        )}
      </div>

      <Modal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Quitter sans enregistrer ?"
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Vos modifications non enregistrées seront perdues si vous quittez cette page.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 min-[360px]:flex-row min-[360px]:justify-end">
          <Button className="w-full min-[360px]:w-auto" variant="ghost" onClick={() => blocker.reset?.()}>
            Rester
          </Button>
          <Button className="w-full min-[360px]:w-auto" variant="danger" onClick={() => blocker.proceed?.()}>
            Quitter sans enregistrer
          </Button>
        </div>
      </Modal>
    </div>
  );
}
