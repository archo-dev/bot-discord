import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomCommandDto } from "@bot/shared";
import { api } from "../lib/api.js";

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
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
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
              <div className="flex items-center gap-2">
                <code className="font-medium text-indigo-300">/{cmd.name}</code>
                {cmd.gatewayRequired && (
                  <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300" title="Les déclencheurs par mot-clé nécessitent le service Gateway (Option B).">
                    mot-clé — nécessite Gateway
                  </span>
                )}
                {(cmd.logic.conditions.length > 0 || cmd.logic.actions.some((a) => a.type !== "reply")) && (
                  <span className="rounded-full bg-purple-950 px-2 py-0.5 text-xs text-purple-300">avancée</span>
                )}
              </div>
              <p className="truncate text-sm text-zinc-500">{cmd.description}</p>
            </div>

            <button
              onClick={() => toggle.mutate(cmd)}
              disabled={toggle.isPending}
              role="switch"
              aria-checked={cmd.enabled}
              className={`relative h-6 w-11 rounded-full transition ${cmd.enabled ? "bg-indigo-600" : "bg-zinc-700"}`}
              title={cmd.enabled ? "Désactiver" : "Activer"}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${cmd.enabled ? "left-[22px]" : "left-0.5"}`}
              />
            </button>

            <Link to={String(cmd.id)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800">
              Modifier
            </Link>
            <button
              onClick={() => {
                if (confirm(`Supprimer /${cmd.name} ?`)) remove.mutate(cmd);
              }}
              className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/40"
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
      {(toggle.isError || remove.isError) && (
        <p className="mt-3 text-sm text-red-400">L'opération a échoué — réessayez.</p>
      )}
    </div>
  );
}
