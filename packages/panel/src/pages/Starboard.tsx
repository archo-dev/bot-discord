import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StarboardSettingsDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Card, Field, InfoCard, Input, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

export function StarboardPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const settings = useQuery({
    queryKey: ["starboard-settings", guildId],
    queryFn: () => api<StarboardSettingsDto>(`/api/guilds/${guildId}/starboard-settings`),
  });

  const [s, setS] = useState<StarboardSettingsDto | null>(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!s) return;
      await api(`/api/guilds/${guildId}/starboard-settings`, { method: "PUT", body: JSON.stringify(s) });
    },
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["starboard-settings", guildId] }),
  });

  const dirty = useDirty(s, settings.data);
  const resetForm = () => settings.data && setS(settings.data);

  if (settings.isPending || !s) return <SkeletonSettingsPage cards={2} />;

  const set = (patch: Partial<StarboardSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <fieldset disabled={!canWrite} className="max-w-2xl space-y-4">
      <Card
        title="Starboard"
        description="Les messages qui atteignent un seuil de réactions sont republiés dans un salon best-of."
        action={<Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} />}
      >
        <div className="space-y-4">
          <Field label="Salon du starboard">
            <ChannelSelect
              guildId={guildId!}
              value={s.channelId}
              onChange={(id) => set({ channelId: id })}
              placeholder="— Choisir un salon —"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Seuil (nombre de réactions)">
              <Input
                type="number"
                min={1}
                max={50}
                value={s.threshold}
                onChange={(e) => set({ threshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="Emoji">
              <Input value={s.emoji} onChange={(e) => set({ emoji: e.target.value })} maxLength={64} placeholder="⭐" />
            </Field>
          </div>
        </div>
      </Card>

      <InfoCard icon={<Icon.star />} title="Bon à savoir">
        Le décompte exclut les bots et l'auteur du message (pas d'auto-star). L'embed se met à jour quand le nombre de
        réactions change et disparaît s'il repasse sous le seuil. Nécessite le service Gateway. Pour un emoji
        personnalisé, colle son tag <code>{"<:nom:id>"}</code>.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle"}
        onSave={() => save.mutate()}
        onReset={resetForm}
      />
    </fieldset>
  );
}
