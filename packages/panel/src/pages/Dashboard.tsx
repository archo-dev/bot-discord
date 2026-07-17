import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  ChannelOption,
  ChannelStatsDto,
  GuildOverview,
  MemberStatsDto,
  ModActionDto,
  OnboardingResponse,
  Paginated,
  PresenceStatsDto,
} from "@bot/shared";
import { api } from "../lib/api.js";
import { Card, EmptyState, ErrorCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonDashboard, SkeletonList } from "../ui/skeleton.js";
import { UserCell } from "../ui/cells.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../ui/mod-meta.js";

export function Dashboard() {
  const { guildId } = useParams<{ guildId: string }>();
  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const actions = useQuery({
    queryKey: ["mod-actions", guildId, 1, ""],
    queryFn: () => api<Paginated<ModActionDto>>(`/api/guilds/${guildId}/mod-actions?page=1`),
  });
  // Mini-stats (M19) — best-effort : chaque carte se dégrade proprement si vide/erreur.
  const memberStats = useQuery({
    queryKey: ["stats-members", guildId, 7],
    queryFn: () => api<MemberStatsDto>(`/api/guilds/${guildId}/stats/members?days=7`),
  });
  const presence = useQuery({
    queryKey: ["stats-presence", guildId],
    queryFn: () => api<PresenceStatsDto | null>(`/api/guilds/${guildId}/stats/presence`),
  });
  const channelStats = useQuery({
    queryKey: ["stats-channels", guildId, 7],
    queryFn: () => api<ChannelStatsDto>(`/api/guilds/${guildId}/stats/channels?days=7`),
  });
  // Encart de prise en main, masqué une fois la configuration marquée terminée (best-effort).
  const onboarding = useQuery({
    queryKey: ["onboarding", guildId],
    queryFn: () => api<OnboardingResponse>(`/api/guilds/${guildId}/onboarding`),
  });

  if (overview.isPending) return <SkeletonDashboard />;
  if (overview.isError) {
    return <ErrorCard message="Impossible de charger l'aperçu du serveur." onRetry={() => void overview.refetch()} />;
  }

  const g = overview.data;
  const logChannel = channels.data?.find((ch) => ch.id === g.logChannelId);
  const channelName = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? id;
  const recent = actions.data?.items.slice(0, 5) ?? [];

  const snaps = memberStats.data?.snapshots ?? [];
  const deltas = memberStats.data?.deltas ?? [];
  const joins7 = deltas.reduce((n, d) => n + d.joins, 0);
  const leaves7 = deltas.reduce((n, d) => n + d.leaves, 0);
  const totals = snaps.map((s) => s.total);
  const net7 = totals.length >= 2 ? totals[totals.length - 1]! - totals[0]! : null;
  const pres = presence.data ?? null;
  const hasStats = snaps.length > 0 || deltas.length > 0;
  const topMsg = channelStats.data?.topMessages.slice(0, 5) ?? [];

  const statsLink = (
    <Link to={`/guilds/${guildId}/stats`} className="text-[13px] font-medium text-indigo-400 hover:underline">
      Détails
    </Link>
  );

  const ob = onboarding.data;
  const obPct = ob && ob.progress.total > 0 ? Math.round((ob.progress.done / ob.progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Encart prise en main (M06) — visible tant que la configuration n'est pas terminée. */}
      {ob && !ob.completedAt && (
        <Link
          to={`/guilds/${guildId}/onboarding`}
          className="flex flex-col gap-3 rounded-xl border border-indigo-800/60 bg-indigo-950/30 p-5 transition hover:border-indigo-600/70 sm:flex-row sm:items-center"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300">
            <Icon.star />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-indigo-100">Terminez la configuration de votre serveur</p>
            <p className="mt-0.5 text-sm text-indigo-200/70">
              {ob.progress.done} étape(s) sur {ob.progress.total} — presets, permissions et checklist guidée.
            </p>
            <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-indigo-950">
              <div className="h-full rounded-full bg-indigo-400" style={{ width: `${obPct}%` }} />
            </div>
          </div>
          <span className="shrink-0 text-indigo-300" aria-hidden>→</span>
        </Link>
      )}

      {/* Un seul résumé scannable remplace quatre cartes KPI concurrentes. */}
      <Card pad="compact" className="overflow-hidden">
        <dl className="grid grid-cols-2 divide-x-0 divide-y divide-zinc-800/80 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <SummaryMetric icon="users" label="Membres" value={g.approximateMemberCount ?? "?"} />
          <SummaryMetric
            icon="bolt"
            label="Gateway"
            value={g.gatewayConnected ? "Connectée" : "Mode HTTP"}
            tone={g.gatewayConnected ? "success" : "muted"}
          />
          <SummaryMetric
            icon="hash"
            label="Salon de logs"
            value={g.logChannelId ? `#${logChannel?.name ?? "logs"}` : "À configurer"}
            to={g.logChannelId ? undefined : `/guilds/${guildId}/config`}
          />
          <SummaryMetric
            icon="shield"
            label="Avertissements"
            value={`${g.warnThreshold} warns · ${g.warnTimeoutMinutes} min`}
          />
        </dl>
      </Card>

      {/* 3 colonnes équilibrées d'infos utiles : modération, tendance membres, salons actifs. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Modération récente (compact) */}
        <Card
          title="Modération récente"
          pad="compact"
          action={
            <Link to={`/guilds/${guildId}/modlog`} className="text-[13px] font-medium text-indigo-400 hover:underline">
              Voir tout
            </Link>
          }
        >
          {actions.isPending ? (
            <SkeletonList rows={5} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Icon.scroll />}
              title="Aucune action"
              description="Les sanctions (/warn, /mute, /ban…) apparaîtront ici."
              compact
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 py-2">
                  <ModActionIcon action={a.action} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-zinc-100">{actionMeta(a.action).label}</div>
                    <div className="mt-0.5 min-w-0 text-xs text-zinc-400">
                      {a.targetId ? <UserCell userId={a.targetId} /> : <span className="text-zinc-600">—</span>}
                    </div>
                  </div>
                  <TimeAgo iso={a.createdAt} className="shrink-0 text-xs text-zinc-500" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Activité sur 7 jours (M19) */}
        <Card title="Activité · 7 jours" pad="compact" action={statsLink}>
          {!hasStats ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              Les statistiques apparaîtront après quelques heures d'activité (collecte via le service Gateway).
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {totals.length >= 2 && <Sparkline values={totals} />}
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Arrivées" value={`+${joins7}`} tone="green" />
                <MiniStat label="Départs" value={`-${leaves7}`} tone="red" />
                {net7 !== null && (
                  <MiniStat label="Solde membres" value={net7 >= 0 ? `+${net7}` : `${net7}`} tone={net7 >= 0 ? "green" : "red"} />
                )}
                {pres && <MiniStat label="En ligne" value={pres.online} tone="violet" />}
              </div>
            </div>
          )}
        </Card>

        {/* Salons les plus actifs (7 jours) */}
        <Card title="Salons les plus actifs" pad="compact" action={statsLink}>
          {topMsg.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              L'activité des salons apparaîtra après quelques heures (collecte via le service Gateway).
            </p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {topMsg.map((c, i) => (
                <li key={c.channelId} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-center text-xs text-zinc-600">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200">#{channelName(c.channelId)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">{c.value.toLocaleString("fr-FR")} msg</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Bandeau gateway (façon promo) */}
      {!g.gatewayConnected && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
            <Icon.bolt />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-200">Activez le service Gateway</p>
            <p className="mt-0.5 text-sm text-amber-200/70">
              Auto-modération temps réel, messages de bienvenue, logs d'arrivées/départs, XP et musique s'activent avec
              le Gateway. Les réglages peuvent déjà être enregistrés.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sparkline SVG minimaliste (courbe des totaux membres, pas de dépendance chart). */
function Sparkline({ values }: { values: number[] }) {
  const w = 240;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="var(--viz-violet)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const miniStatTone = { green: "text-green-400", red: "text-red-400", violet: "text-indigo-300" } as const;

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone: keyof typeof miniStatTone }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className={`text-lg font-bold leading-none ${miniStatTone[tone]}`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  tone = "default",
  to,
}: {
  icon: "users" | "bolt" | "hash" | "shield";
  label: string;
  value: string | number;
  tone?: "default" | "success" | "muted";
  to?: string;
}) {
  const content = (
    <div className="flex min-h-14 items-center gap-2.5 px-3 py-2 first:pl-2 sm:min-h-0">
      <span className={`shrink-0 [&_svg]:h-[17px] [&_svg]:w-[17px] ${tone === "success" ? "text-green-400" : "text-indigo-400"}`}>
        {Icon[icon]()}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] text-zinc-500">{label}</dt>
        <dd className={`truncate text-[13px] font-semibold ${tone === "muted" ? "text-zinc-400" : "text-zinc-100"}`}>{value}</dd>
      </div>
    </div>
  );
  return to ? <Link to={to} className="rounded-lg transition hover:bg-(--state-hover)">{content}</Link> : content;
}
