import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ResolvedMember } from "@bot/shared";
import { api } from "./api.js";

/*
 * Résolution des membres Discord pour l'UserCell (docs/design_system_v2.md §4.11).
 * Chaque UserCell enregistre son id ; le provider regroupe les ids demandés
 * (debounce 60 ms) et interroge `/members/resolve` en une requête batchée.
 * Valeurs du store : ResolvedMember = résolu · null = résolu-introuvable (dégradé)
 * · undefined = pas encore demandé (dégradé le temps du chargement).
 */

type Store = Record<string, ResolvedMember | null>;

interface MemberCtx {
  store: Store;
  request: (id: string) => void;
}

const Ctx = createContext<MemberCtx | null>(null);

export function MemberResolveProvider({ guildId, children }: { guildId: string; children: ReactNode }) {
  const [store, setStore] = useState<Store>({});
  const requested = useRef<Set<string>>(new Set()); // ids déjà en vol ou résolus
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Réinitialise tout quand on change de serveur.
  useEffect(() => {
    requested.current = new Set();
    pending.current = new Set();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStore({});
  }, [guildId]);

  const flush = useCallback(() => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      api<ResolvedMember[]>(`/api/guilds/${guildId}/members/resolve?ids=${chunk.join(",")}`)
        .then((list) => {
          const found = new Set(list.map((m) => m.id));
          setStore((prev) => {
            const next = { ...prev };
            for (const m of list) next[m.id] = m;
            for (const id of chunk) if (!found.has(id)) next[id] = null;
            return next;
          });
        })
        .catch(() => {
          // Échec réseau : on fige en « introuvable » pour éviter une tempête de retries.
          setStore((prev) => {
            const next = { ...prev };
            for (const id of chunk) if (next[id] === undefined) next[id] = null;
            return next;
          });
        });
    }
  }, [guildId]);

  const request = useCallback(
    (id: string) => {
      if (requested.current.has(id)) return;
      requested.current.add(id);
      pending.current.add(id);
      if (timer.current === null) timer.current = setTimeout(flush, 60);
    },
    [flush],
  );

  const value = useMemo<MemberCtx>(() => ({ store, request }), [store, request]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `undefined` = en cours / hors provider · `null` = introuvable · sinon le membre résolu. */
export function useResolvedMember(id: string | null | undefined): ResolvedMember | null | undefined {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (ctx && id) ctx.request(id);
  }, [ctx, id]);
  if (!ctx || !id) return undefined;
  return ctx.store[id];
}
