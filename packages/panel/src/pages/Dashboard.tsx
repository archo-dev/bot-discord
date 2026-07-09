import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOption, GuildOverview } from "@bot/shared";
import { api } from "../lib/api.js";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

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

  const g = overview.data;
  if (!g) return <p className="text-zinc-400">Chargement…</p>;

  const logChannel = channels.data?.find((ch) => ch.id === g.logChannelId);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Membres"
          value={g.approximateMemberCount !== null ? `≈ ${g.approximateMemberCount}` : "?"}
        />
        <StatCard
          label="Salon de logs"
          value={g.logChannelId ? `#${logChannel?.name ?? g.logChannelId}` : "Non configuré"}
          hint="Configurable dans l'onglet Configuration"
        />
        <StatCard
          label="Seuil d'avertissements"
          value={`${g.warnThreshold} warns`}
          hint={`→ mute auto de ${g.warnTimeoutMinutes} min`}
        />
        <StatCard
          label="Statut du bot"
          value={g.gatewayConnected ? "Gateway connectée" : "HTTP interactions"}
          hint={g.gatewayConnected ? undefined : "Slash commands uniquement"}
        />
      </div>

      {!g.gatewayConnected && (
        <div className="mt-6 rounded-xl border border-amber-900/50 bg-amber-950/30 p-5 text-sm text-amber-200/90">
          <p className="font-medium">Fonctionnalités nécessitant le service Gateway (à venir)</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-200/70">
            <li>Auto-modération en temps réel sur chaque message</li>
            <li>Commandes déclenchées par mot-clé</li>
            <li>Rôle automatique à l'arrivée d'un membre</li>
            <li>Logs d'arrivées / départs</li>
          </ul>
          <p className="mt-2 text-amber-200/60">
            Ces réglages peuvent déjà être enregistrés : ils s'activeront dès que le service Gateway sera déployé.
          </p>
        </div>
      )}
    </div>
  );
}
