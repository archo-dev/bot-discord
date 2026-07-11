import { createContext, useContext } from "react";

/*
 * Niveau d'accès panel de l'utilisateur courant sur la guilde affichée (M15).
 * Alimenté par GuildLayout depuis GuildOverview.access. Les modérateurs sont
 * en lecture seule : l'UI masque/désactive les actions d'écriture, et le
 * Worker refuse de toute façon chaque verbe d'écriture avec 403 — ne jamais
 * se fier au front seul.
 */
export const AccessContext = createContext<{ canWrite: boolean }>({ canWrite: true });

/** True sauf pour les accès « modérateur » (lecture seule). */
export function useCanWrite(): boolean {
  return useContext(AccessContext).canWrite;
}
