import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoRoleEntry, ChannelOption, GuildOverview, RoleOption } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { Card, Chip, Field, InfoCard, Input, Select } from "../ui/kit.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";

export function ConfigPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });
  const autoRoles = useQuery({
    queryKey: ["auto-roles", guildId],
    queryFn: () => api<AutoRoleEntry[]>(`/api/guilds/${guildId}/auto-roles`),
  });

  const [logChannelId, setLogChannelId] = useState<string>("");
  const [warnThreshold, setWarnThreshold] = useState(3);
  const [warnTimeoutMinutes, setWarnTimeoutMinutes] = useState(60);
  const [selectedAutoRoles, setSelectedAutoRoles] = useState<string[]>([]);

  useEffect(() => {
    if (overview.data) {
      setLogChannelId(overview.data.logChannelId ?? "");
      setWarnThreshold(overview.data.warnThreshold);
      setWarnTimeoutMinutes(overview.data.warnTimeoutMinutes);
    }
  }, [overview.data]);

  useEffect(() => {
    if (autoRoles.data) setSelectedAutoRoles(autoRoles.data.map((r) => r.roleId));
  }, [autoRoles.data]);

  const save = useMutation({
    mutationFn: async () => {
      await api(`/api/guilds/${guildId}/config`, {
        method: "PATCH",
        body: JSON.stringify({
          logChannelId: logChannelId || null,
          warnThreshold,
          warnTimeoutMinutes,
        }),
      });
      await api(`/api/guilds/${guildId}/auto-roles`, {
        method: "PUT",
        body: JSON.stringify(selectedAutoRoles),
      });
    },
    // La SaveBar affiche l'échec : pas de toast global en doublon.
    meta: { silentError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["guild", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["auto-roles", guildId] });
    },
  });

  // Dirty state : projection comparée à l'état serveur (D.S. v2 §4.9)
  const initial =
    overview.data && autoRoles.data
      ? {
          logChannelId: overview.data.logChannelId ?? "",
          warnThreshold: overview.data.warnThreshold,
          warnTimeoutMinutes: overview.data.warnTimeoutMinutes,
          autoRoles: autoRoles.data.map((r) => r.roleId).sort(),
        }
      : undefined;
  const dirty = useDirty(
    { logChannelId, warnThreshold, warnTimeoutMinutes, autoRoles: [...selectedAutoRoles].sort() },
    initial,
  );
  const resetForm = () => {
    if (!initial) return;
    setLogChannelId(initial.logChannelId);
    setWarnThreshold(initial.warnThreshold);
    setWarnTimeoutMinutes(initial.warnTimeoutMinutes);
    setSelectedAutoRoles(autoRoles.data?.map((r) => r.roleId) ?? []);
  };

  if (overview.isPending) return <SkeletonSettingsPage cards={3} />;

  return (
    <div className="max-w-2xl space-y-6">
      <Card title="Logs de modération" description="Salon où le bot poste chaque action de modération.">
        <Select value={logChannelId} onChange={(e) => setLogChannelId(e.target.value)}>
          <option value="">— Désactivé —</option>
          {channels.data?.filter((ch) => ch.type !== 4).map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </Select>
      </Card>

      <Card
        title="Avertissements"
        description={
          <>
            Au bout de <b>{warnThreshold}</b> warns actifs, le membre est automatiquement mute{" "}
            <b>{warnTimeoutMinutes} min</b> (appliqué au moment du /warn).
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Seuil de warns" error={fieldError(save.error, "warnThreshold")}>
            <Input
              type="number"
              min={1}
              max={20}
              value={warnThreshold}
              onChange={(e) => setWarnThreshold(Number(e.target.value))}
            />
          </Field>
          <Field label="Durée du mute auto (minutes)" error={fieldError(save.error, "warnTimeoutMinutes")}>
            <Input
              type="number"
              min={1}
              max={40320}
              value={warnTimeoutMinutes}
              onChange={(e) => setWarnTimeoutMinutes(Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Rôles automatiques à l'arrivée"
        description="Attribués par le service Gateway à chaque membre qui rejoint le serveur."
      >
        <div className="flex flex-wrap gap-2">
          {roles.data
            ?.filter((r) => !r.managed)
            .map((r) => (
              <Chip
                key={r.id}
                selected={selectedAutoRoles.includes(r.id)}
                onClick={() =>
                  setSelectedAutoRoles((prev) =>
                    prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                  )
                }
              >
                {r.name}
              </Chip>
            ))}
        </div>
      </Card>

      <InfoCard icon={<Icon.sliders />} title="Bon à savoir">
        Ces réglages s'appliquent immédiatement. Le mute automatique se déclenche au moment du <code>/warn</code> qui
        atteint le seuil, pas rétroactivement.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle"}
        onSave={() => save.mutate()}
        onReset={resetForm}
      />
    </div>
  );
}
