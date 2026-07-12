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
}: {
  dirty: boolean;
  status: "idle" | "pending" | "success" | "error";
  onSave: () => void;
  onReset: () => void;
  errorMessage?: string;
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

  if (!dirty && !justSaved) {
    return null;
  }

  return (
    <div className="sticky bottom-4 z-(--z-sticky) mt-6">
      <div
        role="status"
        className="animate-savebar-in flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700 bg-(--surface-2) px-4 py-3 shadow-(--shadow-md)"
      >
        {justSaved && !dirty ? (
          <span className="text-sm font-semibold text-green-400">✓ Enregistré</span>
        ) : (
          <>
            <span className="text-sm font-semibold text-zinc-100">
              {!canWrite ? (
                "Lecture seule — vos modifications ne peuvent pas être enregistrées"
              ) : status === "pending" ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5" /> Enregistrement en cours
                </span>
              ) : (
                "Modifications non enregistrées"
              )}
            </span>
            {status === "error" && <span className="text-[13px] text-red-400">{errorMessage}</span>}
            <span className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onReset} disabled={status === "pending"}>
                Réinitialiser
              </Button>
              {canWrite && (
                <Button size="sm" onClick={onSave} loading={status === "pending"}>
                  Enregistrer
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
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            Rester
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Quitter sans enregistrer
          </Button>
        </div>
      </Modal>
    </div>
  );
}
