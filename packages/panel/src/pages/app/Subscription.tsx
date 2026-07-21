import { useEffect } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { SubscriptionAssignmentsResponse, SubscriptionResponse } from "@bot/shared";
import { api } from "../../lib/api.js";
import { Button, Card, ErrorCard, PageHeader } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";
import { PlanBadge } from "../../components/PlanBadge.js";
import { SlotMeter } from "../../components/SlotMeter.js";
import { countSuspended, entitlementSourceLabel, formatDateTime } from "../../lib/subscription.js";
import { assignmentStateLabel } from "../../lib/slots.js";

/*
 * Espace abonnement client (M8) — LECTURE seule. Affiche le plan effectif et les
 * emplacements (résolus backend, M6/M7). Aucun paiement : « Changer d'offre »
 * pointe vers /pricing (« bientôt »). Route lazy, gardée par platform.entitlements.
 */
export function SubscriptionPage() {
  useEffect(() => {
    document.title = "Mon abonnement — Panel du bot";
  }, []);

  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => api<SubscriptionResponse>("/api/subscription"), retry: false });
  const slots = useQuery({
    queryKey: ["subscription", "assignments"],
    queryFn: () => api<SubscriptionAssignmentsResponse>("/api/subscription/assignments"),
    retry: false,
  });

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
              <span className="text-sm text-zinc-300">{entitlementSourceLabel(sub.data.source)}</span>
            </div>
            <Button href="/pricing" variant="secondary" size="sm">Changer d'offre</Button>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Emplacements</dt>
              <dd className="text-zinc-200">{sub.data.slots} serveur{sub.data.slots > 1 ? "s" : ""}</dd>
            </div>
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
          <>
            <SlotMeter used={slots.data.used} total={slots.data.slots} suspended={countSuspended(slots.data.assignments)} />
            {slots.data.assignments.length > 0 ? (
              <ul className="mt-3 divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-zinc-900/60">
                {slots.data.assignments.map((a) => (
                  <li key={a.guildId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs text-zinc-400">{a.guildId}</span>
                    <span className={a.state === "active" ? "text-emerald-400" : "text-amber-400"}>{assignmentStateLabel(a.state)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Aucun serveur affecté pour le moment.</p>
            )}
          </>
        )}
      </section>

      <p className="mt-8 text-xs text-zinc-500">
        Besoin de plus d'emplacements ou de fonctions avancées ? <Link to="/pricing" className="text-indigo-400 hover:underline">Découvrir les offres</Link>.
      </p>
    </main>
  );
}
