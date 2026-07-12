import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TempVoiceSettingsDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { Card, Field, InfoCard, Input, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

export function TempVoicePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const settings = useQuery({
    queryKey: ["temp-voice-settings", guildId],
    queryFn: () => api<TempVoiceSettingsDto>(`/api/guilds/${guildId}/temp-voice-settings`),
  });

  const [s, setS] = useState<TempVoiceSettingsDto | null>(null);
  useEffect(() => {
    if (settings.data) setS(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!s) return;
      await api(`/api/guilds/${guildId}/temp-voice-settings`, { method: "PUT", body: JSON.stringify(s) });
    },
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["temp-voice-settings", guildId] }),
  });

  const dirty = useDirty(s, settings.data);
  const resetForm = () => settings.data && setS(settings.data);

  if (settings.isPending || !s) return <SkeletonSettingsPage cards={2} />;

  const set = (patch: Partial<TempVoiceSettingsDto>) => setS((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <fieldset disabled={!canWrite} className="max-w-3xl space-y-5">
      <Card
        title="Salons vocaux temporaires"
        description="Quand un membre rejoint le salon déclencheur, le bot lui crée un salon vocal personnel et l'y déplace. Le salon disparaît une fois vide."
        action={<Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} />}
      >
        <div className="space-y-4">
          <Field label="Salon déclencheur (« rejoindre pour créer »)">
            <ChannelSelect
              guildId={guildId!}
              value={s.lobbyChannelId}
              onChange={(id) => set({ lobbyChannelId: id })}
              types={[2]}
              placeholder="— Choisir un salon vocal —"
            />
          </Field>
          <Field label="Catégorie des salons créés (facultatif)">
            <ChannelSelect
              guildId={guildId!}
              value={s.categoryId}
              onChange={(id) => set({ categoryId: id })}
              types={[4]}
              placeholder="— Catégorie du salon déclencheur —"
            />
          </Field>
          <Field label="Modèle de nom">
            <Input
              value={s.nameTemplate}
              onChange={(e) => set({ nameTemplate: e.target.value })}
              maxLength={90}
              placeholder="🎧・{user}"
            />
            <p className="mt-1 text-xs text-zinc-500">
              <code>{"{user}"}</code> est remplacé par le pseudo du propriétaire.
            </p>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Limite d'utilisateurs par défaut (0 = illimité)">
              <Input
                type="number"
                min={0}
                max={99}
                value={s.userLimit}
                onChange={(e) => set({ userLimit: Number(e.target.value) })}
              />
            </Field>
            <Field label="Nombre maximum de salons simultanés">
              <Input
                type="number"
                min={1}
                max={25}
                value={s.maxChannels}
                onChange={(e) => set({ maxChannels: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      </Card>

      <InfoCard icon={<Icon.mic />} title="Bon à savoir">
        Le bot a besoin, dans la catégorie concernée, des permissions <strong>Voir le salon</strong>,{" "}
        <strong>Se connecter</strong>, <strong>Gérer les salons</strong> et <strong>Déplacer des membres</strong>. Chaque
        propriétaire gère son salon avec <code>/voice</code> (renommer, limite, verrouiller, autoriser…). Nécessite le
        service Gateway. Salons temporaires actifs : <strong>{s.activeChannels}</strong>.
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
