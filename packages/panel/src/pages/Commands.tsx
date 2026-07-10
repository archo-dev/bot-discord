import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomCommandDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, InfoCard, Toggle } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";

export function CommandsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const commands = useQuery({
    queryKey: ["commands", guildId],
    queryFn: () => api<CustomCommandDto[]>(`/api/guilds/${guildId}/commands`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["commands", guildId] });

  const toggle = useMutation({
    mutationFn: (cmd: CustomCommandDto) =>
      api(`/api/guilds/${guildId}/commands/${cmd.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !cmd.enabled }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (cmd: CustomCommandDto) => api(`/api/guilds/${guildId}/commands/${cmd.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {commands.data ? `${commands.data.length} / 80 commandes` : ""}
        </p>
        <Link
          to="new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          + Nouvelle commande
        </Link>
      </div>

      {commands.isPending && <p className="text-zinc-400">Chargement…</p>}
      {commands.data?.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          Aucune commande personnalisée pour le moment. Créez-en une !
        </div>
      )}

      <ul className="space-y-2">
        {commands.data?.map((cmd) => (
          <li
            key={cmd.id}
            className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-medium text-indigo-300">/{cmd.name}</code>
                {cmd.gatewayRequired && (
                  <span title="Les déclencheurs par mot-clé nécessitent le service Gateway (Option B).">
                    <Badge tone="warning">mot-clé — Gateway</Badge>
                  </span>
                )}
                {(cmd.logic.conditions.length > 0 || cmd.logic.actions.some((a) => a.type !== "reply")) && (
                  <Badge tone="primary">avancée</Badge>
                )}
              </div>
              <p className="truncate text-sm text-zinc-500">{cmd.description}</p>
            </div>

            <span title={cmd.enabled ? "Désactiver" : "Activer"}>
              <Toggle checked={cmd.enabled} onChange={() => !toggle.isPending && toggle.mutate(cmd)} />
            </span>

            <Link
              to={String(cmd.id)}
              className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-medium text-zinc-100 transition hover:bg-zinc-700"
            >
              Modifier
            </Link>
            <button
              onClick={() => {
                if (confirm(`Supprimer /${cmd.name} ?`)) remove.mutate(cmd);
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-red-400 transition hover:bg-red-950/50"
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
      {(toggle.isError || remove.isError) && (
        <p className="mt-3 text-sm text-red-400">L'opération a échoué — réessayez.</p>
      )}

      <div className="mt-6">
        <InfoCard icon={<Icon.command />} title="Bon à savoir">
          Les commandes utilisent une liste d'actions sécurisées (pas d'<code>eval</code>). Les déclencheurs par mot-clé
          nécessitent le service Gateway ; les slash commands fonctionnent en HTTP.
        </InfoCard>
      </div>
    </div>
  );
}
