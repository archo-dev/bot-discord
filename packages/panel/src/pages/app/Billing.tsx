import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BillingInterval, BillingResponse, CheckoutSessionResponse } from "@bot/shared";
import { api, ApiError } from "../../lib/api.js";
import { Button, Card, EmptyState, ErrorCard, PageHeader, SegmentedControl } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";
import { Skeleton } from "../../ui/skeleton.js";
import { PlanBadge } from "../../components/PlanBadge.js";
import { entitlementSourceLabel, formatDateTime } from "../../lib/subscription.js";

/*
 * Facturation client (M9, sandbox) — checkout hosted + portail. Aucune donnée
 * carte ne transite (redirection vers le prestataire). Aucun prix en dur.
 * L'entitlement payant est créé par le webhook (M10), jamais ici. Route lazy,
 * gardée par platform.billing (sous l'espace client platform.entitlements).
 */
const PAID_PLANS = [
  { id: "premium" as const, name: "Premium", desc: "3 serveurs, modération et musique avancées." },
  { id: "business" as const, name: "Business", desc: "5 serveurs, toutes les fonctions et la gestion d'équipe." },
];

export function BillingPage() {
  useEffect(() => {
    document.title = "Facturation — Panel du bot";
  }, []);

  const billing = useQuery({ queryKey: ["billing"], queryFn: () => api<BillingResponse>("/api/billing"), retry: false });
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirect = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<CheckoutSessionResponse>(path, { method: "POST", body: JSON.stringify(body) });
      window.location.href = url;
    } catch (e) {
      setBusy(null);
      setError(
        e instanceof ApiError && (e.code === "billing_unavailable" || e.code === "feature_disabled")
          ? "La facturation n'est pas encore disponible."
          : "Une erreur est survenue. Réessayez plus tard.",
      );
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader eyebrow="Espace client" title="Facturation" description="Gérez votre abonnement et votre moyen de paiement." />

      {billing.isPending ? (
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      ) : billing.isError ? (
        <ErrorCard message="Impossible de charger la facturation." onRetry={() => void billing.refetch()} />
      ) : !billing.data.enabled ? (
        <div className="mt-6">
          <EmptyState
            icon={<Icon.bolt />}
            title="Facturation bientôt disponible"
            description="Les paiements en ligne arriveront prochainement. Vous restez sur l'offre gratuite en attendant."
          />
        </div>
      ) : (
        <>
          {billing.data.subscription && (
            <Card className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PlanBadge plan={billing.data.subscription.planId} />
                  <span className="text-sm text-zinc-300">{entitlementSourceLabel("paid")}</span>
                </div>
                {billing.data.portalAvailable && (
                  <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void redirect("/api/billing/portal", {}, "portal")}>
                    {busy === "portal" ? "Redirection…" : "Gérer mon paiement"}
                  </Button>
                )}
              </div>
              {billing.data.subscription.currentPeriodEnd && (
                <p className="mt-3 text-sm text-zinc-500">
                  {billing.data.subscription.cancelAtPeriodEnd ? "Se termine le " : "Prochain renouvellement le "}
                  {formatDateTime(billing.data.subscription.currentPeriodEnd)}
                </p>
              )}
            </Card>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-zinc-200">Choisir une offre</h2>
            <SegmentedControl
              ariaLabel="Périodicité"
              options={[{ value: "month", label: "Mensuel" }, { value: "year", label: "Annuel" }]}
              value={interval}
              onChange={setInterval}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PAID_PLANS.map((p) => (
              <Card key={p.id}>
                <div className="flex items-center gap-2">
                  <PlanBadge plan={p.id} />
                  <span className="font-semibold text-zinc-100">{p.name}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{p.desc}</p>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void redirect("/api/billing/checkout", { planId: p.id, interval }, `checkout-${p.id}`)}
                >
                  {busy === `checkout-${p.id}` ? "Redirection…" : `Passer à ${p.name}`}
                </Button>
              </Card>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          <p className="mt-6 text-xs text-zinc-500">
            Paiement sécurisé hébergé par notre prestataire — aucune donnée de carte ne transite par nos serveurs.
          </p>
        </>
      )}
    </main>
  );
}
