import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ButtonRoleMessageDto, ChannelOption, RoleOption } from "@bot/shared";
import { api } from "../lib/api.js";
import { Button, Card, EmptyState, Field, IconButton, InfoCard, Input, Select, Textarea } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

const STYLE_OPTIONS = [
  { value: 1, label: "Bleu" },
  { value: 2, label: "Gris" },
  { value: 3, label: "Vert" },
  { value: 4, label: "Rouge" },
] as const;

interface DraftButton {
  roleId: string;
  label: string;
  emoji: string;
  style: number;
}

export function RolesPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const messages = useQuery({
    queryKey: ["button-roles", guildId],
    queryFn: () => api<ButtonRoleMessageDto[]>(`/api/guilds/${guildId}/button-roles`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("Choisissez vos rôles");
  const [description, setDescription] = useState("Cliquez sur un bouton pour recevoir (ou retirer) le rôle.");
  const [buttons, setButtons] = useState<DraftButton[]>([]);
  const [toDelete, setToDelete] = useState<ButtonRoleMessageDto | null>(null);

  const textChannels = channels.data?.filter((ch) => ch.type !== 4) ?? [];
  const assignableRoles = roles.data?.filter((r) => !r.managed) ?? [];

  const publish = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/button-roles`, {
        method: "POST",
        body: JSON.stringify({
          channelId,
          title,
          description: description || null,
          buttons: buttons.map((b) => ({ roleId: b.roleId, label: b.label, emoji: b.emoji || null, style: b.style })),
        }),
      }),
    meta: { errorMessage: "Échec de la publication — vérifiez les permissions du bot dans le salon." },
    onSuccess: () => {
      setButtons([]);
      toast.success(`Message publié dans #${textChannels.find((c) => c.id === channelId)?.name ?? "le salon"}`);
      void queryClient.invalidateQueries({ queryKey: ["button-roles", guildId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/button-roles/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Message de rôles supprimé" },
    onSuccess: () => {
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["button-roles", guildId] });
    },
  });

  const addButton = () => {
    const firstFree = assignableRoles.find((r) => !buttons.some((b) => b.roleId === r.id));
    if (!firstFree) return;
    setButtons((prev) => [...prev, { roleId: firstFree.id, label: firstFree.name, emoji: "", style: 2 }]);
  };

  const setButton = (i: number, patch: Partial<DraftButton>) =>
    setButtons((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const canPublish = channelId && title.trim() && buttons.length > 0 && buttons.every((b) => b.roleId && b.label.trim());

  return (
    <div className="space-y-4">
      {/* M21 : builder à gauche, messages publiés + astuce à droite. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      {/* fieldset disabled (M15) : composition + publication neutralisées en lecture seule. */}
      <fieldset disabled={!canWrite} className="contents">
      <Card>
        <h2 className="text-title font-semibold text-zinc-100">Nouveau message de rôles</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Publie un message avec des boutons : un clic ajoute le rôle, un second le retire. Fonctionne sans le Gateway.
        </p>

        <div className="mt-4 grid gap-4">
          <Field label="Salon">
            <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— Choisir un salon —</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Titre">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={256} />
          </Field>
          <Field label="Description (optionnel)">
            {/* Variante compacte : min-h du Textarea kit neutralisée (style local) pour préserver
                le rythme rows=2 existant — le DS admet une variante dense (2.2.d, décision B). */}
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={2}
              style={{ minHeight: 0 }}
            />
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-300">Boutons ({buttons.length}/25)</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={addButton}
              disabled={buttons.length >= 25 || assignableRoles.length === 0}
            >
              + Bouton
            </Button>
          </div>
          {buttons.map((b, i) => (
            // Rangée dense : selects auto via `!w-auto`, inputs fixes via `!w-*` — le kit impose `w-full`
            // (émis après `.w-auto`/`.w-<n>` dans le CSS). `size="sm"` = 32 px = hauteur historique. cf. spec 2.2.f.
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
              <Select
                size="sm"
                className="!w-auto"
                value={b.roleId}
                onChange={(e) => {
                  const role = assignableRoles.find((r) => r.id === e.target.value);
                  setButton(i, { roleId: e.target.value, label: role?.name ?? b.label });
                }}
              >
                {assignableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
              <Input
                size="sm"
                className="!w-40"
                value={b.label}
                onChange={(e) => setButton(i, { label: e.target.value })}
                maxLength={80}
                placeholder="Libellé"
              />
              <Input
                size="sm"
                className="!w-20 text-center"
                value={b.emoji}
                onChange={(e) => setButton(i, { emoji: e.target.value })}
                maxLength={8}
                placeholder="Emoji"
              />
              <Select
                size="sm"
                className="!w-auto"
                value={b.style}
                onChange={(e) => setButton(i, { style: Number(e.target.value) })}
              >
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <IconButton
                label="Retirer ce bouton"
                danger
                className="ml-auto"
                onClick={() => setButtons((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </IconButton>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => publish.mutate()} disabled={!canPublish} loading={publish.isPending}>
            Publier le message
          </Button>
        </div>
      </Card>
      </fieldset>

      <div className="space-y-4">
      <Card>
        <h2 className="text-title font-semibold text-zinc-100">Messages publiés</h2>
        <div className="mt-3 divide-y divide-zinc-800">
          {messages.isPending && <SkeletonList rows={2} />}
          {messages.data?.length === 0 && (
            <EmptyState
              icon={<Icon.tag />}
              title="Aucun message de rôles"
              description="Composez un message ci-dessus puis publiez-le : il apparaîtra ici avec ses boutons."
            />
          )}
          {messages.data?.map((m) => (
            <div key={m.id} className="py-3">
              <div className="flex items-center gap-3">
                <span className="font-medium">{m.title}</span>
                <span className="text-sm text-zinc-500">
                  #{textChannels.find((c) => c.id === m.channelId)?.name ?? m.channelId}
                </span>
                {canWrite && (
                  <IconButton
                    label={`Supprimer ${m.title}`}
                    danger
                    onClick={() => setToDelete(m)}
                    className="ml-auto"
                  >
                    <Icon.close />
                  </IconButton>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {m.buttons.map((b) => (
                  <span key={b.id} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
                    {b.emoji ? `${b.emoji} ` : ""}
                    {b.label} → {roles.data?.find((r) => r.id === b.roleId)?.name ?? b.roleId}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      </div>
      </div>

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer le message de rôles"
        subject={
          <>
            Supprimer <b className="text-zinc-100">« {toDelete?.title} »</b> ?
          </>
        }
        consequence="Le message Discord et ses boutons seront aussi supprimés. Les rôles déjà attribués sont conservés."
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />

      <InfoCard icon={<Icon.tag />} title="Astuce">
        Le rôle du bot doit être placé <b>au-dessus</b> des rôles distribués (Paramètres du serveur → Rôles), sinon
        Discord refuse l'attribution (erreur de hiérarchie). Les boutons fonctionnent sans le Gateway.
      </InfoCard>
    </div>
  );
}
