import { useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ButtonRoleMessageCreate,
  ButtonRoleMessageDto,
  ChannelOption,
  GuildModuleDto,
  GuildModulesResponse,
  RoleOption,
} from "@bot/shared";
import { DiscordMessagePreview } from "../components/previews/DiscordMessagePreview.js";
import { ModuleWorkspace } from "../components/modules/ModuleWorkspace.js";
import { useCanWrite } from "../lib/access.js";
import { api, ApiError } from "../lib/api.js";
import { MODULE_STATE_META, moduleReasonLabel } from "../lib/modules.js";
import {
  addRoleButton,
  buildRolesPreview,
  createRolesDraft,
  draftAfterPublish,
  isRolesDraftPublishable,
  removeRoleButton,
  rolesDraftErrors,
  toButtonRoleCreate,
  updateRoleButton,
  type RolesDraft,
} from "../lib/roles-preview.js";
import { Badge, Button, Card, EmptyState, ErrorCard, Field, IconButton, Input, Select, Textarea } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { Skeleton, SkeletonSettingsPage } from "../ui/skeleton.js";
import type { GuildOutletContext } from "./GuildLayout.js";

const STYLE_OPTIONS = [
  { value: 1, label: "Bleu" },
  { value: 2, label: "Gris" },
  { value: 3, label: "Vert" },
  { value: 4, label: "Rouge" },
] as const;

const PERMISSION_LABELS = {
  view_channel: "Voir le salon",
  send_messages: "Envoyer des messages",
  manage_roles: "Gérer les rôles",
} as const;

function publishErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "La publication a échoué. Le brouillon est conservé.";
  if (error.status === 403) return "Publication refusée : votre accès ou les permissions du bot sont insuffisants.";
  if (error.code === "discord_error") return "Discord a refusé la publication. Vérifiez le salon et les permissions du bot.";
  if (error.category === "network") return "Connexion indisponible. Le brouillon est conservé ; réessayez plus tard.";
  if (error.category === "timeout") return "La publication prend trop de temps. Le brouillon est conservé.";
  return "La publication a échoué. Le brouillon est conservé.";
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "Suppression refusée : permissions insuffisantes.";
  return "Impossible de supprimer ce message. Il reste publié et peut être réessayé.";
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponible";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function moduleDiagnostic(module: GuildModuleDto | undefined): string {
  if (!module) return "Les informations du module ne sont pas disponibles.";
  const reasons = module.enabled ? module.reasons : module.activationReasons;
  return moduleReasonLabel(reasons[0] ?? { code: module.enabled ? "module_enabled" : "module_disabled" });
}

function StatusLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-zinc-300",
    success: "text-emerald-300",
    warning: "text-amber-300",
    danger: "text-red-300",
  }[tone];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`max-w-[62%] break-words text-right text-xs font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

function PublishedMessages({
  messages,
  channels,
  roles,
  canWrite,
  onDelete,
}: {
  messages: readonly ButtonRoleMessageDto[];
  channels: readonly ChannelOption[];
  roles: readonly RoleOption[];
  canWrite: boolean;
  onDelete: (message: ButtonRoleMessageDto, trigger: HTMLButtonElement) => void;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<Icon.tag />}
        title="Aucun message publié"
        description="Le premier message apparaîtra ici après sa publication dans Discord."
      />
    );
  }
  return (
    <ul className="divide-y divide-white/5">
      {messages.map((message) => (
        <li key={message.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs font-semibold text-zinc-200">{message.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                #{channels.find((channel) => channel.id === message.channelId)?.name ?? message.channelId}
              </p>
            </div>
            {canWrite && (
              <IconButton
                label={`Supprimer ${message.title}`}
                danger
                onClick={(event) => onDelete(message, event.currentTarget)}
              >
                <Icon.close />
              </IconButton>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.buttons.map((button) => (
              <span key={button.id} className="max-w-full truncate rounded-full border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400">
                {button.emoji ? `${button.emoji} ` : ""}
                {button.label} → {roles.find((role) => role.id === button.roleId)?.name ?? button.roleId}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-600">Publié le {formatPublishedAt(message.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

export function RolesPage() {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guild } = useOutletContext<GuildOutletContext>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [draft, setDraft] = useState<RolesDraft>(() => createRolesDraft());
  const [baseline, setBaseline] = useState<RolesDraft>(() => createRolesDraft());
  const [toDelete, setToDelete] = useState<ButtonRoleMessageDto | null>(null);
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLButtonElement | null>(null);
  const [publishAttempted, setPublishAttempted] = useState(false);

  const messages = useQuery({
    queryKey: ["button-roles", guildId],
    queryFn: ({ signal }) => api<ButtonRoleMessageDto[]>(`/api/guilds/${guildId}/button-roles`, { signal }),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: ({ signal }) => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`, { signal }),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: ({ signal }) => api<RoleOption[]>(`/api/guilds/${guildId}/roles`, { signal }),
  });
  const modules = useQuery({
    queryKey: ["modules", guildId],
    queryFn: ({ signal }) => api<GuildModulesResponse>(`/api/guilds/${guildId}/modules`, { signal }),
    staleTime: 60_000,
  });

  const textChannels = useMemo(
    () => channels.data?.filter((channel) => channel.type !== 4) ?? [],
    [channels.data],
  );
  const assignableRoles = useMemo(
    () => roles.data?.filter((role) => !role.managed) ?? [],
    [roles.data],
  );
  const roleModule = modules.data?.modules.find((module) => module.id === "button_roles");
  const preview = useMemo(() => buildRolesPreview(draft, assignableRoles), [assignableRoles, draft]);
  const validation = rolesDraftErrors(draft);
  const dirty = useDirty(draft, baseline);
  const validDraft = isRolesDraftPublishable(draft);
  const moduleAllowsConfiguration = roleModule?.actions.canConfigure ?? true;
  const canPublish = canWrite && validDraft && moduleAllowsConfiguration;
  const latestPublished = messages.data?.reduce<ButtonRoleMessageDto | null>(
    (latest, message) => latest === null || message.createdAt > latest.createdAt ? message : latest,
    null,
  ) ?? null;

  const publish = useMutation({
    mutationFn: (payload: ButtonRoleMessageCreate) =>
      api<ButtonRoleMessageDto>(`/api/guilds/${guildId}/button-roles`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    meta: { silentError: true },
    onSuccess: () => {
      const next = draftAfterPublish(draft);
      setDraft(next);
      setBaseline(next);
      setPublishAttempted(false);
      void queryClient.invalidateQueries({ queryKey: ["button-roles", guildId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/button-roles/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Message de rôles supprimé" },
    onSuccess: () => {
      setToDelete(null);
      setDeleteTrigger(null);
      void queryClient.invalidateQueries({ queryKey: ["button-roles", guildId] });
    },
  });

  const requestPublish = () => {
    setPublishAttempted(true);
    if (!canPublish || publish.isPending) return;
    publish.mutate(toButtonRoleCreate(draft));
  };
  const closeDelete = () => {
    setToDelete(null);
    remove.reset();
    queueMicrotask(() => deleteTrigger?.focus());
    setDeleteTrigger(null);
  };

  if (channels.isPending || roles.isPending || messages.isPending) {
    return <SkeletonSettingsPage cards={3} />;
  }
  if (channels.isError || roles.isError) {
    return (
      <ErrorCard
        message="Impossible de charger les salons ou les rôles disponibles."
        onRetry={() => {
          void channels.refetch();
          void roles.refetch();
        }}
      />
    );
  }

  const moduleMeta = roleModule ? MODULE_STATE_META[roleModule.state] : null;
  const publishStatus = publish.isPending ? "pending" : publish.isError ? "error" : publish.isSuccess ? "success" : "idle";
  const dirtyState = publish.isPending
    ? "Publication en cours"
    : publish.isError
      ? "Échec de publication"
      : dirty
        ? "Modifications non publiées"
        : "Brouillon propre";

  return (
    <div className="min-w-0 space-y-4 pb-3">
      <ModuleWorkspace
        configuration={
          <fieldset disabled={!canWrite || !moduleAllowsConfiguration} className="space-y-3">
            {!canWrite && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                Lecture seule : vous pouvez consulter la configuration et l’aperçu, mais pas publier de message.
              </div>
            )}
            {canWrite && !moduleAllowsConfiguration && (
              <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-xs leading-relaxed text-red-200">
                Publication indisponible : les permissions ou capacités requises pour configurer ce module sont insuffisantes.
              </div>
            )}

            <Card title="Destination" description="Choisissez le salon texte qui recevra le message." pad="compact">
              <Field
                label="Salon cible"
                hint="Le salon doit autoriser le bot à voir et envoyer des messages."
                error={publishAttempted ? validation.channelId : undefined}
              >
                <Select
                  value={draft.channelId}
                  onChange={(event) => setDraft((current) => ({ ...current, channelId: event.target.value }))}
                >
                  <option value="">— Choisir un salon —</option>
                  {textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                </Select>
              </Field>
            </Card>

            <Card title="Contenu du message" description="Ce contenu alimente uniquement l’aperçu local jusqu’à la publication." pad="compact">
              <div className="grid gap-3">
                <Field
                  label="Titre"
                  hint={`${draft.title.length}/256 caractères`}
                  error={publishAttempted ? validation.title : undefined}
                >
                  <Input
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    maxLength={256}
                  />
                </Field>
                <Field label="Description (optionnelle)" hint={`${draft.description.length}/2000 caractères`}>
                  <Textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    maxLength={2000}
                    rows={4}
                    className="!min-h-24"
                  />
                </Field>
              </div>
            </Card>

            <Card title="Rôles et boutons" description="Un clic attribue le rôle ; un second clic le retire." pad="compact">
              <fieldset>
                <legend className="sr-only">Boutons de rôles configurés</legend>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-zinc-400">
                    <span className="font-semibold tabular-nums text-zinc-200">{draft.buttons.length}</span>/25 boutons
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDraft((current) => addRoleButton(current, assignableRoles))}
                    disabled={draft.buttons.length >= 25 || assignableRoles.length === 0}
                  >
                    <span aria-hidden>＋</span> Ajouter un rôle
                  </Button>
                </div>

                {publishAttempted && validation.buttons && (
                  <p role="alert" className="mt-2 text-xs text-red-400">{validation.buttons}</p>
                )}

                {draft.buttons.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-zinc-700/80 bg-zinc-950/25 px-3 py-6 text-center">
                    <p className="text-xs font-semibold text-zinc-300">Aucun bouton configuré</p>
                    <p className="mt-1 text-[11px] text-zinc-500">Ajoutez un rôle pour construire le message.</p>
                  </div>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {draft.buttons.map((button, index) => (
                      <li key={`${button.roleId}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bouton {index + 1}</span>
                          <IconButton
                            label={`Retirer le bouton ${index + 1}`}
                            danger
                            onClick={() => setDraft((current) => removeRoleButton(current, index))}
                          >
                            <Icon.close />
                          </IconButton>
                        </div>
                        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                          <Field label="Rôle attribué">
                            <Select
                              size="sm"
                              aria-label={`Rôle attribué par le bouton ${index + 1}`}
                              value={button.roleId}
                              onChange={(event) => {
                                const role = assignableRoles.find((candidate) => candidate.id === event.target.value);
                                setDraft((current) => updateRoleButton(current, index, {
                                  roleId: event.target.value,
                                  label: role?.name ?? button.label,
                                }));
                              }}
                            >
                              {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                            </Select>
                          </Field>
                          <Field
                            label="Libellé"
                            error={publishAttempted ? validation.buttonLabels[index] : undefined}
                          >
                            <Input
                              size="sm"
                              aria-label={`Libellé du bouton ${index + 1}`}
                              value={button.label}
                              onChange={(event) => setDraft((current) => updateRoleButton(current, index, { label: event.target.value }))}
                              maxLength={80}
                            />
                          </Field>
                          <Field label="Emoji (optionnel)" hint="Emoji Unicode, 8 caractères maximum.">
                            <Input
                              size="sm"
                              aria-label={`Emoji du bouton ${index + 1}`}
                              value={button.emoji}
                              onChange={(event) => setDraft((current) => updateRoleButton(current, index, { emoji: event.target.value }))}
                              maxLength={8}
                              placeholder="✨"
                            />
                          </Field>
                          <Field label="Couleur du bouton">
                            <Select
                              size="sm"
                              aria-label={`Couleur du bouton ${index + 1}`}
                              value={button.style}
                              onChange={(event) => setDraft((current) => updateRoleButton(current, index, { style: Number(event.target.value) }))}
                            >
                              {STYLE_OPTIONS.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                            </Select>
                          </Field>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </fieldset>
            </Card>
          </fieldset>
        }
        preview={<DiscordMessagePreview preview={preview} />}
        context={
          <div className="space-y-3">
            <Card title="État de publication" description="Informations issues des contrats existants." pad="compact">
              <dl>
                <StatusLine
                  label="Module"
                  value={moduleMeta?.label ?? (modules.isPending ? "Chargement…" : "Non disponible")}
                  tone={roleModule?.state === "enabled" ? "success" : roleModule ? "warning" : "neutral"}
                />
                <StatusLine
                  label="Gateway"
                  value={guild?.gatewayConnected ? "Connectée · non requise" : "Indisponible · non bloquante"}
                  tone={guild?.gatewayConnected ? "success" : "warning"}
                />
                <StatusLine
                  label="Votre accès"
                  value={canWrite ? "Administration" : "Lecture seule"}
                  tone={canWrite ? "success" : "warning"}
                />
                <StatusLine
                  label="Configuration"
                  value={!canWrite ? "Lecture seule" : moduleAllowsConfiguration ? "Autorisée" : "Permission insuffisante"}
                  tone={!canWrite || !moduleAllowsConfiguration ? "danger" : "success"}
                />
                <StatusLine
                  label="Salon cible"
                  value={textChannels.find((channel) => channel.id === draft.channelId)?.name
                    ? `#${textChannels.find((channel) => channel.id === draft.channelId)!.name}`
                    : "Non sélectionné"}
                />
                <StatusLine
                  label="Messages publiés"
                  value={`${messages.data?.length ?? 0}`}
                />
                <StatusLine
                  label="Dernière publication"
                  value={latestPublished ? formatPublishedAt(latestPublished.createdAt) : "Non disponible"}
                />
                <StatusLine
                  label="Brouillon"
                  value={dirtyState}
                  tone={publish.isError ? "danger" : dirty ? "warning" : "success"}
                />
              </dl>
              <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                {modules.isError ? "État du module non disponible. " : moduleDiagnostic(roleModule)}
                {" "}La publication passe directement par Discord ; aucun brouillon distant ni statut de synchronisation n’existe.
              </p>
            </Card>

            <Card title="Prérequis Discord" description="Vérifiés à nouveau au moment de publier." pad="compact">
              <ul className="space-y-2">
                {(roleModule?.requiredPermissions ?? ["view_channel", "send_messages", "manage_roles"]).map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-xs text-zinc-400">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />
                    {PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS] ?? permission}
                  </li>
                ))}
                <li className="flex items-start gap-2 text-xs text-zinc-400">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />
                  Le rôle du bot doit rester au-dessus des rôles distribués.
                </li>
              </ul>
            </Card>

            <Card
              title="Messages publiés"
              description="Suppression disponible uniquement avec un accès administrateur."
              pad="compact"
            >
              {messages.isError ? (
                <ErrorCard message="Impossible de charger les messages publiés." onRetry={() => void messages.refetch()} />
              ) : (
                <PublishedMessages
                  messages={messages.data ?? []}
                  channels={textChannels}
                  roles={roles.data ?? []}
                  canWrite={canWrite}
                  onDelete={(message, trigger) => {
                    remove.reset();
                    setDeleteTrigger(trigger);
                    setToDelete(message);
                  }}
                />
              )}
            </Card>
          </div>
        }
      />

      <SaveBar
        dirty={dirty}
        status={publishStatus}
        onSave={requestPublish}
        onReset={() => {
          setDraft(baseline);
          setPublishAttempted(false);
          publish.reset();
        }}
        errorMessage={publishErrorMessage(publish.error)}
        actionLabel="Publier"
        pendingLabel="Publication en cours"
        dirtyLabel="Modifications non publiées"
        successLabel="✓ Message publié"
        cleanLabel="Brouillon prêt"
        readOnlyLabel="Lecture seule — consultation uniquement"
        showWhenClean
        actionDisabled={!canPublish}
      />

      <ConfirmModal
        open={toDelete !== null}
        title="Supprimer le message de rôles"
        subject={<>Supprimer <b className="text-zinc-100">« {toDelete?.title} »</b> ?</>}
        consequence="Le message Discord et ses boutons seront aussi supprimés. Les rôles déjà attribués sont conservés."
        loading={remove.isPending}
        error={remove.isError ? deleteErrorMessage(remove.error) : undefined}
        onCancel={closeDelete}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </div>
  );
}
