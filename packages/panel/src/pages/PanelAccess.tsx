import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PanelAccessEntry, RoleOption } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Button, Card, Chip, InfoCard, Input, SaveFeedback } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";

export function PanelAccessPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const entries = useQuery({
    queryKey: ["panel-access", guildId],
    queryFn: () => api<PanelAccessEntry[]>(`/api/guilds/${guildId}/panel-access`),
    retry: false,
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [newUserId, setNewUserId] = useState("");

  useEffect(() => {
    if (entries.data) {
      setSelectedRoles(entries.data.filter((e) => e.subjectType === "role").map((e) => e.subjectId));
      setUserIds(entries.data.filter((e) => e.subjectType === "user").map((e) => e.subjectId));
    }
  }, [entries.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/panel-access`, {
        method: "PUT",
        body: JSON.stringify([
          ...selectedRoles.map((id) => ({ subjectType: "role", subjectId: id })),
          ...userIds.map((id) => ({ subjectType: "user", subjectId: id })),
        ]),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["panel-access", guildId] }),
  });

  if (entries.isError && entries.error instanceof ApiError && entries.error.status === 403) {
    return (
      <p className="text-zinc-400">
        Seuls les membres avec la permission « Gérer le serveur » peuvent configurer l'accès au panel.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card
        title="Rôles autorisés"
        description="Les membres de ces rôles peuvent utiliser le panel même sans la permission « Gérer le serveur »."
      >
        <div className="flex flex-wrap gap-2">
          {roles.data
            ?.filter((r) => !r.managed)
            .map((r) => (
              <Chip
                key={r.id}
                selected={selectedRoles.includes(r.id)}
                onClick={() =>
                  setSelectedRoles((prev) =>
                    prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                  )
                }
              >
                {r.name}
              </Chip>
            ))}
        </div>
      </Card>

      <Card title="Utilisateurs autorisés (par ID)">
        <div className="flex gap-2">
          <Input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="ID utilisateur Discord"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (/^\d{5,20}$/.test(newUserId) && !userIds.includes(newUserId)) {
                setUserIds((prev) => [...prev, newUserId]);
                setNewUserId("");
              }
            }}
          >
            Ajouter
          </Button>
        </div>
        <ul className="mt-3 space-y-1.5">
          {userIds.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 text-sm">
              <code>{id}</code>
              <button
                onClick={() => setUserIds((prev) => prev.filter((u) => u !== id))}
                className="text-zinc-500 transition hover:text-red-400"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {save.isSuccess && <SaveFeedback status="success" />}
        {save.isError && <span className="text-sm text-red-400">Échec (permission « Gérer le serveur » requise)</span>}
      </div>

      <InfoCard icon={<Icon.key />} title="Bon à savoir">
        Les membres avec la permission « Gérer le serveur » ont <b>toujours</b> accès au panel. Ajoute ici des
        rôles ou des utilisateurs supplémentaires sans leur donner cette permission Discord.
      </InfoCard>
    </div>
  );
}
