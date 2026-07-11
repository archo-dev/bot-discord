import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomCommandDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, EmptyState, InfoCard, Toggle } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

export function CommandsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [toDelete, setToDelete] = useState<CustomCommandDto | null>(null);

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
    onSuccess: (_data, cmd) => {
      invalidate();
      toast.success(`/${cmd.name} ${cmd.enabled ? "désactivée" : "activée"}`);
    },
  });

  const remove = useMutation({
    mutationFn: (cmd: CustomCommandDto) => api(`/api/guilds/${guildId}/commands/${cmd.id}`, { method: "DELETE" }),
    onSuccess: (_data, cmd) => {
      invalidate();
      setToDelete(null);
      toast.success(`/${cmd.name} supprimée`);
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {commands.data ? `${commands.data.length} / 80 commandes` : ""}
        </p>
        {canWrite && (
          <Link
            to="new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            + Nouvelle commande
          </Link>
        )}
      </div>

      {commands.isPending && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4">
          <SkeletonList rows={4} />
        </div>
      )}
      {commands.data?.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <EmptyState
            icon={<Icon.command />}
            title="Aucune commande personnalisée"
            description="Créez votre première commande : le bot l'enregistre sur Discord en quelques secondes, sans redémarrage."
            action={
              <Link
                to="new"
                className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-semibold text-zinc-100 transition hover:bg-zinc-700"
              >
                Créer une commande
              </Link>
            }
          />
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

            <span
              title={!canWrite ? "Lecture seule" : cmd.enabled ? "Désactiver" : "Activer"}
              className={!canWrite ? "pointer-events-none opacity-50" : undefined}
            >
              <Toggle checked={cmd.enabled} onChange={() => canWrite && !toggle.isPending && toggle.mutate(cmd)} />
            </span>

            <Link
              to={String(cmd.id)}
              className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-medium text-zinc-100 transition hover:bg-zinc-700"
            >
              {canWrite ? "Modifier" : "Voir"}
            </Link>
            {canWrite && (
              <button
                onClick={() => setToDelete(cmd)}
                className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-red-400 transition hover:bg-red-950/50"
              >
                Supprimer
              </button>
            )}
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer la commande"
        subject={
          <>
            Supprimer <b className="text-zinc-100">/{toDelete?.name}</b> ?
          </>
        }
        consequence="La commande sera aussi retirée de Discord. Cette action est définitive."
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />

      <div className="mt-6">
        <InfoCard icon={<Icon.command />} title="Bon à savoir">
          Les commandes utilisent une liste d'actions sécurisées (pas d'<code>eval</code>). Les déclencheurs par mot-clé
          nécessitent le service Gateway ; les slash commands fonctionnent en HTTP.
        </InfoCard>
      </div>
    </div>
  );
}
