import { useCallback } from "react";
import type { StudioPermission } from "@bot/shared";
import { useOverview } from "../hooks/useOverview.js";
import { errorInfoFr } from "../lib/errors.js";
import type { Tab } from "../lib/nav.js";
import { ErrorState, useToast } from "../ui/index.js";
import { HealthStrip } from "../components/overview/HealthStrip.js";
import { OverviewHeader } from "../components/overview/OverviewHeader.js";
import { OverviewSkeleton } from "../components/overview/OverviewSkeleton.js";
import { PrioritySection } from "../components/overview/PrioritySection.js";
import { QuickActionCard } from "../components/overview/QuickActionCard.js";
import { RecentActivity } from "../components/overview/RecentActivity.js";
import { StatCard } from "../components/overview/StatCard.js";

/**
 * Operator dashboard (Lot 3). Composes real data from existing GET endpoints
 * only (overview + public /status + errors/audit when permitted). Every number
 * is real; missing data degrades to « Inconnu »/« Non disponible »/empty.
 * Navigation and quick actions honour the same can(...) gating as App.
 */
export function OverviewPanel({
  can,
  onNavigate,
}: {
  can: (permission: StudioPermission) => boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const canErrors = can("deployments.read"); // metrics/errors/rollout pages
  const canAudit = can("audit.read");
  const canSupport = can("support.manage");
  const canGuilds = can("guilds.inspect");
  const canSubs = can("subscriptions.read"); // subscriptions + grants pages

  const toast = useToast();
  const onRefreshError = useCallback(
    (code: string) => {
      const info = errorInfoFr(code);
      toast.error("Rafraîchissement impossible", info.description);
    },
    [toast],
  );

  const { overview, status, errors, audit, error, loading, refreshing, lastUpdatedAt, refresh } =
    useOverview({ canErrors, canAudit, onRefreshError });

  if (loading) return <OverviewSkeleton />;

  if (!overview) {
    return <ErrorState code={error ?? "network_error"} onRetry={refresh} />;
  }

  const totalOpenTickets =
    overview.openTickets.high + overview.openTickets.normal + overview.openTickets.low;
  const totalErrors = errors ? errors.items.reduce((sum, b) => sum + b.errors, 0) : null;

  return (
    <div>
      <OverviewHeader lastUpdatedAt={lastUpdatedAt} refreshing={refreshing} onRefresh={refresh} />

      <HealthStrip status={status} latestUpdate={overview.latestUpdate} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon="server"
          value={overview.guilds}
          label="Guildes"
          onClick={canGuilds ? () => onNavigate("guilds") : undefined}
        />
        <StatCard
          icon="card"
          value={overview.activeEntitlements}
          label="Entitlements actifs"
          onClick={canSubs ? () => onNavigate("subscriptions") : undefined}
        />
        <StatCard
          icon="life"
          value={totalOpenTickets}
          label="Tickets ouverts"
          hint={`dont ${overview.openTickets.high} haute priorité`}
          onClick={canSupport ? () => onNavigate("support") : undefined}
        />
        {canErrors && (
          <StatCard
            icon="alert"
            value={totalErrors ?? "—"}
            label="Erreurs récentes"
            hint={totalErrors === null ? "Non disponible" : `sur ${errors?.windowHours} h`}
            onClick={() => onNavigate("errors")}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PrioritySection
          openTicketsHigh={overview.openTickets.high}
          errors={errors}
          canSupport={canSupport}
          canErrors={canErrors}
          onNavigate={onNavigate}
        />

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
          <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100">
            Accès rapides
          </div>
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {canGuilds && (
              <QuickActionCard icon="server" title="Guildes" subtitle="Inspecter les serveurs" onClick={() => onNavigate("guilds")} />
            )}
            {canSupport && (
              <QuickActionCard icon="life" title="Support" subtitle="File des tickets" onClick={() => onNavigate("support")} />
            )}
            {canSubs && (
              <QuickActionCard icon="gift" title="Octrois" subtitle="Accès offerts" onClick={() => onNavigate("grants")} />
            )}
            {canErrors && (
              <QuickActionCard icon="toggle" title="Rollout" subtitle="Flags & cohortes" onClick={() => onNavigate("rollout")} />
            )}
            {canErrors && (
              <QuickActionCard icon="activity" title="Métriques" subtitle="Observabilité" onClick={() => onNavigate("metrics")} />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <RecentActivity events={audit} canAudit={canAudit} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
