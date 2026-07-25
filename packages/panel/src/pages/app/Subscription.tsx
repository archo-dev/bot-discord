import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuildSummary, SubscriptionAssignmentsResponse, SubscriptionResponse } from "@bot/shared";
import { api, ApiError } from "../../lib/api.js";
import { Button, Card, ErrorCard, PageHeader } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";
import { PlanBadge } from "../../components/PlanBadge.js";
import { SlotMeter } from "../../components/SlotMeter.js";
import { featureAccessMessage, formatDateTime, showGlobalEarlyAccessNote, subscriptionSourceLabel } from "../../lib/subscription.js";
import { assignmentStateLabel, composeSlots } from "../../lib/slots.js";

/*
 * Espace abonnement client (M8) — plan effectif + emplacements (résolus backend,
 * M6/M7). La note « accès bêta » ne s'affiche que pour les comptes SANS
 * entitlement explicite (fix : un Business Lifetime offert n'est plus re-libellé
 * « accès anticipé »). La section emplacements croise /api/subscription/assignments
 * (compteur canonique) avec /api/guilds (noms + serveurs éligibles à affecter).
 * Route lazy, gardée par platform.entitlements.
 */

/** Message FR d'un échec d'affectation d'emplacement. */
function assignErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : "error";
  switch (code) {
    case "no_slot_available":
      return "Aucun emplacement disponible — libérez-en un d'abord.";
    case "reassign_cooldown":
      return "Réaffectation trop récente pour ce serveur, réessayez plus tard.";
    case "guild_already_assigned":
      return "Ce serveur est déjà affecté à un emplacement.";
    case "no_active_entitlement":
      return "Aucune offre active ne permet d'affecter un serveur.";
    case "forbidden":
      return "Vous devez gérer ce serveur (Gérer le serveur) pour l'affecter.";
    case "bot_not_installed":
      return "Le bot n'est plus présent sur ce serveur.";
    default:
      return "Action impossible pour le moment.";
  }
}

export function SubscriptionPage() {
  useEffect(() => {
    document.title = "Mon abonnement — Panel du bot";
  }, []);

  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const sub = useQuery({ queryKey: ["subscription"], queryFn: ({ signal }) => api<SubscriptionResponse>("/api/subscription", { signal }), retry: false });
  const slots = useQuery({
    queryKey: ["subscription", "assignments"],
    queryFn: ({ signal }) => api<SubscriptionAssignmentsResponse>("/api/subscription/assignments", { signal }),
    retry: false,
  });
  // Noms des serveurs + éligibilité (déjà filtré bot_installed=1, MANAGE_GUILD).
  const guilds = useQuery({
    queryKey: ["guilds"],
    queryFn: ({ signal }) => api<GuildSummary[]>("/api/guilds", { signal }),
    retry: false,
  });

  const refreshSlots = () => {
    void queryClient.invalidateQueries({ queryKey: ["subscription", "assignments"] });
    void queryClient.invalidateQueries({ queryKey: ["subscription"] });
  };

  const assign = useMutation({
    mutationFn: (guildId: string) =>
      api<SubscriptionAssignmentsResponse>("/api/subscription/assignment", { method: "POST", body: JSON.stringify({ guildId }) }),
    meta: { silentError: true },
    onMutate: () => setActionError(null),
    onSuccess: refreshSlots,
    onError: (err) => setActionError(assignErrorMessage(err)),
  });
  const release = useMutation({
    mutationFn: (guildId: string) =>
      api<SubscriptionAssignmentsResponse>("/api/subscription/assignment", { method: "DELETE", body: JSON.stringify({ guildId }) }),
    meta: { silentError: true },
    onMutate: () => setActionError(null),
    onSuccess: refreshSlots,
    onError: (err) => setActionError(assignErrorMessage(err)),
  });
  const busy = assign.isPending || release.isPending;

  const accessMessage = sub.data ? featureAccessMessage(sub.data.featureAccessMode) : null;
  const showEarlyNote = sub.data ? showGlobalEarlyAccessNote(sub.data.featureAccessMode, sub.data.source) : false;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader eyebrow="Espace client" title="Mon abonnement" description="Votre offre actuelle et vos emplacements de serveurs." />

      {sub.isPending ? (
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      ) : sub.isError ? (
        <ErrorCard message="Impossible de charger votre abonnement." onRetry={() => void sub.refetch()} />
      ) : (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <PlanBadge plan={sub.data.planId} />
              <span className="text-sm text-zinc-300">{subscriptionSourceLabel(sub.data.originKind, sub.data.isLifetime)}</span>
            </div>
            <Button href="/pricing" variant="secondary" size="sm">Changer d'offre</Button>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Emplacements</dt>
              <dd className="text-zinc-200">{sub.data.slots} serveur{sub.data.slots > 1 ? "s" : ""}</dd>
            </div>
            {sub.data.startAt ? (
              <div>
                <dt className="text-zinc-500">Depuis le</dt>
                <dd className="text-zinc-200">{formatDateTime(sub.data.startAt)}</dd>
              </div>
            ) : null}
            {sub.data.isLifetime ? (
              <div>
                <dt className="text-zinc-500">Validité</dt>
                <dd className="text-zinc-200">À vie</dd>
              </div>
            ) : sub.data.endAt ? (
              <div>
                <dt className="text-zinc-500">Valable jusqu'au</dt>
                <dd className="text-zinc-200">{formatDateTime(sub.data.endAt)}</dd>
              </div>
            ) : null}
          </dl>
          {showEarlyNote && accessMessage && (
            <p className="mt-4 text-sm text-zinc-300">
              <span className="font-medium text-zinc-100">Accès anticipé.</span>{" "}
              {accessMessage}
            </p>
          )}
          {!sub.data.entitlementsEnabled && (
            <p className="mt-4 text-xs text-zinc-500">
              Les offres payantes ne sont pas encore actives — vous êtes sur l'offre gratuite. Les abonnements arriveront bientôt.
            </p>
          )}
        </Card>
      )}

      <section aria-labelledby="slots-title" className="mt-8">
        <h2 id="slots-title" className="mb-3 text-sm font-semibold text-zinc-200">Emplacements de serveurs</h2>
        {slots.isPending ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : slots.isError ? (
          <ErrorCard message="Impossible de charger vos emplacements." onRetry={() => void slots.refetch()} />
        ) : (
          (() => {
            const comp = composeSlots(slots.data, guilds.data ?? []);
            const canAssign = comp.total > 0;
            return (
              <>
                <SlotMeter used={comp.used} total={comp.total} suspended={comp.suspended} />

                {actionError && <p className="mt-3 text-sm text-rose-400">{actionError}</p>}

                {/* Serveurs affectés */}
                <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Serveurs affectés</h3>
                {comp.assigned.length > 0 ? (
                  <ul className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-zinc-900/60">
                    {comp.assigned.map((a) => (
                      <li key={a.guildId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 truncate">
                          <span className="text-zinc-200">{a.name ?? "Serveur inconnu"}</span>
                          <span className="ml-2 font-mono text-xs text-zinc-500">{a.guildId}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className={a.state === "active" ? "text-emerald-400" : "text-amber-400"}>{assignmentStateLabel(a.state)}</span>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => release.mutate(a.guildId)}>Libérer</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500">Aucun serveur affecté pour le moment.</p>
                )}

                {/* Serveurs connectés éligibles, non affectés */}
                {canAssign && comp.available.length > 0 && (
                  <>
                    <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {comp.available.length} serveur{comp.available.length > 1 ? "s" : ""} disponible{comp.available.length > 1 ? "s" : ""} à affecter
                    </h3>
                    <ul className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-zinc-900/60">
                      {comp.available.map((g) => (
                        <li key={g.guildId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                          <span className="min-w-0 truncate text-zinc-200">{g.name}</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || comp.used >= comp.total}
                            onClick={() => assign.mutate(g.guildId)}
                          >
                            Affecter
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {comp.used >= comp.total && (
                      <p className="mt-2 text-xs text-zinc-500">Tous vos emplacements sont utilisés — libérez-en un pour affecter un autre serveur.</p>
                    )}
                  </>
                )}

                {guilds.isError && (
                  <p className="mt-2 text-xs text-zinc-500">Impossible de lister vos serveurs connectés pour le moment.</p>
                )}
              </>
            );
          })()
        )}
      </section>

      <p className="mt-8 text-xs text-zinc-500">
        Besoin de plus d'emplacements ou de fonctions avancées ? <Link to="/pricing" className="text-indigo-400 hover:underline">Découvrir les offres</Link>.
      </p>
    </main>
  );
}
