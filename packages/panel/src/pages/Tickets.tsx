import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_TICKET_FORM,
  type ChannelOption,
  type GuildModulesResponse,
  type MeResponse,
  type Paginated,
  type RoleOption,
  type TicketDto,
  type TicketEventDto,
  type TicketFormConfig,
  type TicketPatchAction,
  type TicketSettingsDto,
  type TicketSettingsUpdate,
  type TicketStatsDto,
} from "@bot/shared";
import { ModuleWorkspace } from "../components/modules/ModuleWorkspace.js";
import { TicketPanelPreview } from "../components/previews/TicketPanelPreview.js";
import { api, ApiError, fieldError } from "../lib/api.js";
import { buildTicketPanelPreview, validateTicketSettingsDraft } from "../lib/ticket-preview.js";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorCard,
  Field,
  InfoCard,
  Input,
  Pagination,
  Select,
  Textarea,
  Toggle,
} from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { Drawer, Modal } from "../ui/overlay.js";
import { UserCell } from "../ui/cells.js";
import { TimeAgo } from "../ui/mod-meta.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonList, SkeletonSettingsPage } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

const STATE_LABELS = { open: "Ouvert", pending: "En attente", closed: "Fermé" } as const;
const EVENT_LABELS: Record<TicketEventDto["type"], string> = {
  created: "Ticket créé",
  assigned: "Ticket assigné",
  unassigned: "Assignation retirée",
  state_changed: "État modifié",
  priority_changed: "Priorité modifiée",
  closed: "Ticket fermé",
};

function cloneForm(form: TicketFormConfig): TicketFormConfig {
  return JSON.parse(JSON.stringify(form)) as TicketFormConfig;
}

function nextId(prefix: string, existing: Array<{ id: string }>): string {
  for (let index = 1; index < 100; index++) {
    const candidate = `${prefix}_${index}`;
    if (!existing.some((entry) => entry.id === candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36).slice(-5)}`;
}

function ticketSaveError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Échec de l’enregistrement. Le brouillon est conservé.";
  if (error.status === 403) return "Enregistrement refusé : permissions insuffisantes.";
  if (error.category === "network") return "Connexion indisponible. Le brouillon est conservé.";
  return "Échec de l’enregistrement. Le brouillon est conservé.";
}

function ContextLine({ label, value, tone = "neutral" }: {
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
      <dd className={`max-w-[64%] break-words text-right text-xs font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

export function TicketsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const settings = useQuery({
    queryKey: ["ticket-settings", guildId],
    queryFn: ({ signal }) => api<TicketSettingsDto>(`/api/guilds/${guildId}/tickets/settings`, { signal }),
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

  const [enabled, setEnabled] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [staffRoleIds, setStaffRoleIds] = useState<string[]>([]);
  const [transcriptChannelId, setTranscriptChannelId] = useState("");
  const [formEnabled, setFormEnabled] = useState(false);
  const [form, setForm] = useState<TicketFormConfig>(() => cloneForm(DEFAULT_TICKET_FORM));
  const [panelChannelId, setPanelChannelId] = useState("");
  const [panelTitle, setPanelTitle] = useState("Support");
  const [panelDescription, setPanelDescription] = useState("Besoin d'aide ? Ouvrez un ticket et le staff vous répondra.");

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setCategoryId(settings.data.categoryId ?? "");
    setStaffRoleIds(settings.data.staffRoleIds);
    setTranscriptChannelId(settings.data.transcriptChannelId ?? "");
    setFormEnabled(settings.data.formEnabled);
    setForm(cloneForm(settings.data.form));
  }, [settings.data]);

  const textChannels = channels.data?.filter((channel) => channel.type !== 4) ?? [];
  const payload: TicketSettingsUpdate = {
    enabled,
    categoryId: categoryId || null,
    staffRoleIds,
    transcriptChannelId: transcriptChannelId || null,
    formEnabled,
    form,
  };
  const validation = validateTicketSettingsDraft(payload);
  const saveSettings = useMutation({
    mutationFn: async () => {
      await api(`/api/guilds/${guildId}/tickets/settings`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      return payload;
    },
    meta: { silentError: true },
    onSuccess: (saved) => {
      queryClient.setQueryData<TicketSettingsDto>(["ticket-settings", guildId], (previous) => previous ? {
        ...previous,
        ...saved,
        form: cloneForm(saved.form),
      } : previous);
      void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] });
    },
  });
  const publishPanel = useMutation({
    mutationFn: () => api(`/api/guilds/${guildId}/tickets/panel`, {
      method: "POST",
      body: JSON.stringify({ channelId: panelChannelId, title: panelTitle, description: panelDescription }),
    }),
    meta: { errorMessage: "Échec de la publication — enregistrez d'abord les réglages et vérifiez les permissions du bot." },
    onSuccess: () => {
      toast.success(`Panneau publié dans #${textChannels.find((channel) => channel.id === panelChannelId)?.name ?? "le salon"}`);
      void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] });
    },
  });

  const current = { enabled, categoryId, staffRoleIds: [...staffRoleIds].sort(), transcriptChannelId, formEnabled, form };
  const initial = settings.data ? {
    enabled: settings.data.enabled,
    categoryId: settings.data.categoryId ?? "",
    staffRoleIds: [...settings.data.staffRoleIds].sort(),
    transcriptChannelId: settings.data.transcriptChannelId ?? "",
    formEnabled: settings.data.formEnabled,
    form: settings.data.form,
  } : undefined;
  const dirty = useDirty(current, initial);
  const resetForm = () => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setCategoryId(settings.data.categoryId ?? "");
    setStaffRoleIds(settings.data.staffRoleIds);
    setTranscriptChannelId(settings.data.transcriptChannelId ?? "");
    setFormEnabled(settings.data.formEnabled);
    setForm(cloneForm(settings.data.form));
  };

  const updateCategory = (index: number, patch: Partial<TicketFormConfig["categories"][number]>) => {
    setForm((previous) => ({ ...previous, categories: previous.categories.map((entry, currentIndex) => currentIndex === index ? { ...entry, ...patch } : entry) }));
  };
  const updateField = (index: number, patch: Partial<TicketFormConfig["fields"][number]>) => {
    setForm((previous) => ({ ...previous, fields: previous.fields.map((entry, currentIndex) => currentIndex === index ? { ...entry, ...patch } : entry) }));
  };

  if (settings.isPending || channels.isPending || roles.isPending) return <SkeletonSettingsPage cards={4} />;
  if (settings.isError || channels.isError || roles.isError) {
    return (
      <ErrorCard
        message="Impossible de charger la configuration complète des tickets."
        onRetry={() => {
          void settings.refetch();
          void channels.refetch();
          void roles.refetch();
        }}
      />
    );
  }

  const module = modules.data?.modules.find((candidate) => candidate.id === "tickets");
  const moduleAllowsConfiguration = module?.actions.canConfigure ?? !modules.isError;
  const targetCategory = channels.data?.find((channel) => channel.id === categoryId)?.name ?? "";
  const transcriptChannel = channels.data?.find((channel) => channel.id === transcriptChannelId)?.name ?? "";
  const selectedRoles = roles.data?.filter((role) => staffRoleIds.includes(role.id)).map((role) => role.name) ?? [];
  const currentPanelChannel = textChannels.find((channel) => channel.id === settings.data?.panelChannelId)?.name;
  const preview = buildTicketPanelPreview(panelTitle, panelDescription, formEnabled, form);
  const saveStatus = saveSettings.isPending ? "pending" : saveSettings.isError ? "error" : saveSettings.isSuccess ? "success" : "idle";
  const publicationBlocked = dirty || !categoryId || validation.messages.length > 0;

  return (
    <div className="min-w-0 space-y-4 pb-3">
      {modules.isError && (
        <ErrorCard
          compact
          title="Capacités du module indisponibles"
          message="La configuration et les tickets restent consultables, mais les mutations sont neutralisées jusqu’au chargement des capacités."
          onRetry={() => void modules.refetch()}
          retrying={modules.isFetching}
        />
      )}
      <ModuleWorkspace
        configurationDescription="Activez le service, choisissez les accès et définissez le formulaire de triage."
        previewDescription="Panneau Discord indicatif, dérivé uniquement du brouillon local."
        contextDescription="État réel, permissions, destination et limites exposées par les contrats."
        configuration={
          <fieldset disabled={!canWrite || !moduleAllowsConfiguration} className="min-w-0 space-y-3">
            {!canWrite && (
              <div role="status" className="rounded-xl border border-amber-900/60 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200">
                Lecture seule : la configuration, l’aperçu et les tickets restent consultables.
              </div>
            )}
            {canWrite && modules.isSuccess && !moduleAllowsConfiguration && (
              <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-2.5 text-xs text-red-200">
                Enregistrement indisponible : une permission ou capacité requise manque.
              </div>
            )}
            {module && !module.enabled && (
              <div role="status" className="rounded-xl border border-zinc-700 bg-zinc-900/70 px-3 py-2.5 text-xs text-zinc-300">
                Module désactivé : aucun nouveau ticket ne sera ouvert ; les tickets et réglages existants sont conservés.
              </div>
            )}
            {validation.messages.length > 0 && (
              <div role="alert" className="rounded-xl border border-red-900/60 bg-red-950/25 px-3 py-3 text-xs text-red-200">
                <p className="font-semibold">Corrigez les erreurs du brouillon :</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {validation.messages.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            )}

            <Card
              title="Activation et destination"
              description="Le module crée un salon privé dans la catégorie choisie."
              action={<Toggle ariaLabel="Activer le système de tickets" checked={enabled} onChange={setEnabled} />}
              pad="compact"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Catégorie des tickets" hint={!categoryId && enabled ? "Requise avant de publier un panneau." : undefined}>
                  <ChannelSelect guildId={guildId!} value={categoryId || null} onChange={(id) => setCategoryId(id ?? "")} types={[4]} placeholder="— Choisir une catégorie —" />
                </Field>
                <Field label="Salon des transcripts" hint="Optionnel.">
                  <ChannelSelect guildId={guildId!} value={transcriptChannelId || null} onChange={(id) => setTranscriptChannelId(id ?? "")} placeholder="— Aucun —" />
                </Field>
              </div>
              <div className="mt-3">
                <p className="mb-2 text-[13px] font-medium text-zinc-300">Rôles de l’équipe support</p>
                <div className="flex flex-wrap gap-2" aria-label="Rôles de l’équipe support">
                  {roles.data?.filter((role) => !role.managed).map((role) => (
                    <Chip
                      key={role.id}
                      selected={staffRoleIds.includes(role.id)}
                      onClick={() => setStaffRoleIds((previous) => previous.includes(role.id) ? previous.filter((id) => id !== role.id) : previous.length < 10 ? [...previous, role.id] : previous)}
                    >
                      {role.name}
                    </Chip>
                  ))}
                </div>
                {validation.errors.staffRoleIds && <p className="mt-1 text-xs text-red-400">{validation.errors.staffRoleIds}</p>}
              </div>
            </Card>

            <Card
              title="Formulaire de triage"
              description="Jusqu’à 5 catégories et 3 questions privées."
              action={<Toggle ariaLabel="Activer le formulaire de triage" checked={formEnabled} onChange={setFormEnabled} />}
              pad="compact"
            >
              <div className="space-y-4">
                <section aria-labelledby="ticket-categories-title">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 id="ticket-categories-title" className="text-sm font-semibold text-zinc-200">Catégories ({form.categories.length}/5)</h3>
                    <Button size="sm" variant="secondary" disabled={form.categories.length >= 5} onClick={() => setForm((previous) => ({
                      ...previous,
                      categories: [...previous.categories, { id: nextId("category", previous.categories), label: "Nouvelle catégorie", description: "", emoji: null }],
                    }))}>Ajouter</Button>
                  </div>
                  <div className="space-y-2">
                    {form.categories.map((category, index) => (
                      <fieldset key={category.id} className="grid min-w-0 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-[64px_1fr_auto]">
                        <legend className="sr-only">Catégorie {index + 1}</legend>
                        <Field label="Emoji"><Input value={category.emoji ?? ""} maxLength={16} onChange={(event) => updateCategory(index, { emoji: event.target.value || null })} /></Field>
                        <div className="grid min-w-0 gap-2">
                          <Field label="Nom" error={validation.errors[`category-${index}-label`]}><Input value={category.label} maxLength={50} onChange={(event) => updateCategory(index, { label: event.target.value })} /></Field>
                          <Field label="Description"><Input value={category.description} maxLength={100} onChange={(event) => updateCategory(index, { description: event.target.value })} /></Field>
                        </div>
                        <Button className="self-end" variant="ghost" size="sm" disabled={form.categories.length === 1} onClick={() => setForm((previous) => ({ ...previous, categories: previous.categories.filter((_, currentIndex) => currentIndex !== index) }))}>Retirer</Button>
                      </fieldset>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="ticket-questions-title">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 id="ticket-questions-title" className="text-sm font-semibold text-zinc-200">Questions ({form.fields.length}/3)</h3>
                    <Button size="sm" variant="secondary" disabled={form.fields.length >= 3} onClick={() => setForm((previous) => ({
                      ...previous,
                      fields: [...previous.fields, { id: nextId("field", previous.fields), label: "Nouvelle question", style: "short", required: false, maxLength: 120 }],
                    }))}>Ajouter</Button>
                  </div>
                  <div className="space-y-2">
                    {form.fields.length === 0 && <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-xs text-zinc-500">Aucune question : seule la catégorie sera demandée.</p>}
                    {form.fields.map((field, index) => (
                      <fieldset key={field.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                        <legend className="sr-only">Question {index + 1}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label="Question" error={validation.errors[`field-${index}-label`]}><Input value={field.label} maxLength={45} onChange={(event) => updateField(index, { label: event.target.value })} /></Field>
                          <Field label="Format"><Select value={field.style} onChange={(event) => updateField(index, { style: event.target.value as "short" | "paragraph" })}><option value="short">Réponse courte</option><option value="paragraph">Paragraphe</option></Select></Field>
                          <Field label="Longueur maximale"><Input type="number" min={32} max={1000} value={field.maxLength} onChange={(event) => updateField(index, { maxLength: Math.min(1000, Math.max(32, Number(event.target.value) || 32)) })} /></Field>
                          <div className="flex items-end justify-between gap-2 pb-1">
                            <Toggle checked={field.required} onChange={(required) => updateField(index, { required })} label="Obligatoire" />
                            <Button variant="ghost" size="sm" onClick={() => setForm((previous) => ({ ...previous, fields: previous.fields.filter((_, currentIndex) => currentIndex !== index) }))}>Retirer</Button>
                          </div>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                </section>
              </div>
            </Card>
          </fieldset>
        }
        preview={
          <div className="space-y-3">
            <TicketPanelPreview preview={preview} />
            <Card
              title="Publication du panneau"
              description={currentPanelChannel ? `Panneau actuel : #${currentPanelChannel}` : "Aucun panneau publié connu."}
              pad="compact"
            >
              <fieldset disabled={!canWrite || !moduleAllowsConfiguration} className="space-y-3">
                <Field label="Salon de publication">
                  <ChannelSelect guildId={guildId!} value={panelChannelId || null} onChange={(id) => setPanelChannelId(id ?? "")} placeholder="— Choisir un salon —" />
                </Field>
                <Field label="Titre" error={fieldError(publishPanel.error, "title")}><Input value={panelTitle} onChange={(event) => setPanelTitle(event.target.value)} maxLength={256} /></Field>
                <Field label="Description" error={fieldError(publishPanel.error, "description")}><Textarea value={panelDescription} onChange={(event) => setPanelDescription(event.target.value)} maxLength={2000} rows={4} /></Field>
                <Button className="w-full" onClick={() => publishPanel.mutate()} disabled={!panelChannelId || publicationBlocked} loading={publishPanel.isPending}>Publier le panneau</Button>
              </fieldset>
              {publicationBlocked && (
                <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
                  {!categoryId ? "Choisissez d’abord la catégorie des tickets." : "Enregistrez un brouillon valide avant de publier."}
                </p>
              )}
            </Card>
          </div>
        }
        context={
          <div className="space-y-3">
            <Card title="État du service" description="Contexte issu des contrats existants." pad="compact">
              <div className="mb-2 flex justify-end">
                <Badge tone={module?.state === "enabled" ? "success" : module ? "warning" : "neutral"}>
                  {module?.state === "enabled" ? "Actif" : module?.enabled === false ? "Désactivé" : modules.isPending ? "Chargement…" : "Non disponible"}
                </Badge>
              </div>
              <dl>
                <ContextLine label="Configuration" value={enabled ? "Activée dans le brouillon" : "Désactivée dans le brouillon"} tone={enabled ? "success" : "warning"} />
                <ContextLine label="Gateway" value="Non requise" tone="success" />
                <ContextLine label="Votre accès" value={canWrite ? "Administration" : "Lecture seule"} tone={canWrite ? "success" : "warning"} />
                <ContextLine label="Capacité" value={moduleAllowsConfiguration ? "Configuration autorisée" : "Permission insuffisante"} tone={moduleAllowsConfiguration ? "success" : "danger"} />
                <ContextLine label="Brouillon" value={saveSettings.isError ? "Échec, brouillon conservé" : dirty ? "Modifications non enregistrées" : "Configuration enregistrée"} tone={saveSettings.isError ? "danger" : dirty ? "warning" : "success"} />
              </dl>
            </Card>
            <Card title="Destination et support" description="Valeurs du brouillon actuel." pad="compact">
              <dl>
                <ContextLine label="Catégorie" value={targetCategory ? targetCategory : "Non sélectionnée"} tone={categoryId ? "success" : "warning"} />
                <ContextLine label="Rôles support" value={selectedRoles.length ? selectedRoles.join(", ") : "Aucun rôle sélectionné"} />
                <ContextLine label="Transcripts" value={transcriptChannel || "Désactivés"} />
                <ContextLine label="Triage" value={formEnabled ? `${form.categories.length} catégorie(s), ${form.fields.length} question(s)` : "Désactivé"} />
              </dl>
            </Card>
            <Card title="Permissions et limites" description="Aucune donnée distante inventée." pad="compact">
              <ul className="space-y-2 text-xs text-zinc-400">
                {(module?.requiredPermissions ?? ["view_channel", "send_messages", "embed_links", "attach_files", "manage_channels"]).map((permission) => (
                  <li key={permission} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />{permission}</li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Publication : quota journalier existant côté serveur. Son utilisation courante n’est pas exposée sur cette page.
              </p>
            </Card>
          </div>
        }
      />

      <TicketStats guildId={guildId!} />
      <TicketList guildId={guildId!} form={settings.data?.form ?? form} canWrite={canWrite} />

      <InfoCard icon={<Icon.ticket />} title="Confidentialité et limites">
        Les réponses et transcripts sont réservés aux personnes ayant accès au panel et chargés à la demande. La timeline conserve uniquement des métadonnées pendant 180 jours. « Vieillissant » reste un indicateur visuel et n’envoie aucun rappel automatique.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={saveStatus}
        onSave={() => saveSettings.mutate()}
        onReset={() => {
          resetForm();
          saveSettings.reset();
        }}
        actionDisabled={!moduleAllowsConfiguration || validation.messages.length > 0}
        errorMessage={ticketSaveError(saveSettings.error)}
        showWhenClean={!canWrite}
        cleanLabel="Configuration Tickets enregistrée"
      />
    </div>
  );
}

function TicketStats({ guildId }: { guildId: string }) {
  const stats = useQuery({ queryKey: ["ticket-stats", guildId], queryFn: ({ signal }) => api<TicketStatsDto>(`/api/guilds/${guildId}/tickets/stats`, { signal }) });
  if (stats.isPending) return <SkeletonList rows={2} />;
  if (stats.isError) return <ErrorCard message="Impossible de charger les statistiques de tickets." onRetry={() => void stats.refetch()} />;
  const values = [
    ["Actifs", stats.data.open + stats.data.pending],
    ["Non assignés", stats.data.unassigned],
    ["Priorité haute", stats.data.highPriority],
    ["Vieillissants +24 h", stats.data.aging],
    ["Médiane avant assignation", stats.data.medianAssignMinutes === null ? "—" : `${stats.data.medianAssignMinutes} min`],
  ] as const;
  return (
    <Card title="Vue d'équipe" description="Agrégats calculés sur les métadonnées, jamais sur les réponses ou transcripts.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {values.map(([label, value]) => <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p></div>)}
      </div>
    </Card>
  );
}

function TicketList({ guildId, form, canWrite }: { guildId: string; form: TicketFormConfig; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"" | "open" | "pending" | "closed">("");
  const [priority, setPriority] = useState<"" | "normal" | "high">("");
  const [assignee, setAssignee] = useState<"" | "unassigned">("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<TicketDto | null>(null);
  const [transcriptOf, setTranscriptOf] = useState<TicketDto | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => api<MeResponse>("/api/me", { signal }) });
  const params = new URLSearchParams({ page: String(page) });
  if (state) params.set("state", state);
  if (priority) params.set("priority", priority);
  if (assignee) params.set("assignee", assignee);
  const tickets = useQuery({
    queryKey: ["tickets", guildId, page, state, priority, assignee],
    queryFn: ({ signal }) => api<Paginated<TicketDto>>(`/api/guilds/${guildId}/tickets?${params.toString()}`, { signal }),
  });
  const events = useQuery({
    queryKey: ["ticket-events", guildId, detail?.id],
    queryFn: ({ signal }) => api<TicketEventDto[]>(`/api/guilds/${guildId}/tickets/${detail!.id}/events`, { signal }),
    enabled: detail !== null,
  });
  const transcript = useQuery({
    queryKey: ["ticket-transcript", guildId, transcriptOf?.id],
    queryFn: ({ signal }) => api<{ number: number; transcript: string }>(`/api/guilds/${guildId}/tickets/${transcriptOf!.id}/transcript`, { signal }),
    enabled: transcriptOf !== null,
  });
  const patch = useMutation({
    mutationFn: ({ ticketId, action }: { ticketId: number; action: TicketPatchAction }) => api<TicketDto>(`/api/guilds/${guildId}/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify(action) }),
    onSuccess: (updated) => {
      setDetail((current) => current?.id === updated.id ? updated : current);
      void queryClient.invalidateQueries({ queryKey: ["tickets", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["ticket-stats", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["ticket-events", guildId, updated.id] });
    },
  });
  const totalPages = tickets.data ? Math.max(Math.ceil(tickets.data.total / tickets.data.pageSize), 1) : 1;
  const categoryLabel = (key: string | null) => form.categories.find((category) => category.id === key)?.label ?? (key ? key : "Ancien panneau");
  const resetPage = () => setPage(1);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleTickets = tickets.data?.items.filter((ticket) => {
    if (!normalizedSearch) return true;
    return [
      String(ticket.number).padStart(4, "0"),
      ticket.userId,
      ticket.channelId,
      categoryLabel(ticket.categoryKey),
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  }) ?? [];

  return (
    <Card
      title={`Tickets (${tickets.data?.total ?? "…"})`}
      description="Recherche locale dans la page chargée ; les filtres d’état, priorité et assignation sont appliqués par le serveur."
    >
      {me.isError && (
        <div className="mb-3">
          <ErrorCard
            compact
            title="Identité panel indisponible"
            message="Les tickets restent consultables. L’état de votre assignation ne peut pas être déterminé tant que votre session n’est pas relue."
            onRetry={() => void me.refetch()}
            retrying={me.isFetching}
          />
        </div>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Input aria-label="Rechercher dans les tickets chargés" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="N°, membre, salon…" className="h-9" />
        <Select aria-label="Filtrer par état" value={state} onChange={(event) => { setState(event.target.value as typeof state); resetPage(); }} className="h-9"><option value="">Tous les états</option><option value="open">Ouverts</option><option value="pending">En attente</option><option value="closed">Fermés</option></Select>
        <Select aria-label="Filtrer par priorité" value={priority} onChange={(event) => { setPriority(event.target.value as typeof priority); resetPage(); }} className="h-9"><option value="">Toutes priorités</option><option value="high">Haute</option><option value="normal">Normale</option></Select>
        <Select aria-label="Filtrer par assignation" value={assignee} onChange={(event) => { setAssignee(event.target.value as typeof assignee); resetPage(); }} className="h-9"><option value="">Toute assignation</option><option value="unassigned">Non assignés</option></Select>
      </div>
      {tickets.isPending ? <SkeletonList rows={4} /> : tickets.isError ? (
        <ErrorCard message="Impossible de charger les tickets." onRetry={() => void tickets.refetch()} />
      ) : visibleTickets.length === 0 ? (
        <EmptyState icon={<Icon.ticket />} title="Aucun ticket pour ces critères" action={<Button variant="secondary" size="sm" onClick={() => { setSearch(""); setState(""); setPriority(""); setAssignee(""); resetPage(); }}>Effacer les critères</Button>} />
      ) : (
        <div className="divide-y divide-white/5">
          {visibleTickets.map((ticket) => (
            <article key={ticket.id} className="grid min-w-0 gap-3 py-3 text-sm md:grid-cols-[auto_1fr_auto] md:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ticket.state === "open" ? "success" : ticket.state === "pending" ? "warning" : "neutral"}>{STATE_LABELS[ticket.state]}</Badge>
                {ticket.priority === "high" && <Badge tone="danger">Haute</Badge>}
                <span className="font-medium">#{String(ticket.number).padStart(4, "0")}</span>
              </div>
              <div className="min-w-0 text-zinc-400">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">par <UserCell userId={ticket.userId} /> · <TimeAgo iso={ticket.createdAt} /> · {categoryLabel(ticket.categoryKey)}</p>
                <p className="mt-1 break-all text-xs text-zinc-500">Salon {ticket.channelId}{ticket.assigneeId && <span className="inline-flex items-center gap-1"> · assigné à <UserCell userId={ticket.assigneeId} /></span>}</p>
              </div>
              <div className="flex w-full items-center gap-2 md:w-auto md:justify-end">
                {canWrite && ticket.state !== "closed" && (
                  <Button className="flex-1 md:flex-none" size="sm" variant="secondary" loading={patch.isPending && patch.variables?.ticketId === ticket.id} onClick={() => patch.mutate({ ticketId: ticket.id, action: ticket.assigneeId === me.data?.id ? { action: "unassign" } : { action: "claim" } })}>
                    {ticket.assigneeId === me.data?.id ? "Libérer" : "Prendre"}
                  </Button>
                )}
                {canWrite && ticket.state === "closed" && (
                  <Button className="flex-1 md:flex-none" size="sm" variant="secondary" loading={patch.isPending && patch.variables?.ticketId === ticket.id} onClick={() => patch.mutate({ ticketId: ticket.id, action: { action: "reopen" } })}>
                    Rouvrir
                  </Button>
                )}
                <Button className="flex-1 md:flex-none" size="sm" variant="ghost" onClick={() => setDetail(ticket)}>Détails</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {tickets.data && <Pagination page={page} totalPages={totalPages} total={tickets.data.total} onPage={setPage} />}

      <Drawer open={detail !== null} onClose={() => setDetail(null)} title={detail ? `Ticket #${String(detail.number).padStart(4, "0")}` : ""}>
        {detail && <div className="space-y-5">
          <div className="flex flex-wrap gap-2"><Badge tone={detail.state === "open" ? "success" : detail.state === "pending" ? "warning" : "neutral"}>{STATE_LABELS[detail.state]}</Badge><Badge tone={detail.priority === "high" ? "danger" : "neutral"}>Priorité {detail.priority === "high" ? "haute" : "normale"}</Badge><Badge>{categoryLabel(detail.categoryKey)}</Badge></div>
          {detail.formResponse && Object.keys(detail.formResponse).length > 0 && <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"><h3 className="mb-3 text-sm font-semibold text-zinc-200">Réponses privées</h3><dl className="space-y-3">{Object.entries(detail.formResponse).map(([id, value]) => <div key={id}><dt className="text-xs text-zinc-500">{form.fields.find((field) => field.id === id)?.label ?? id}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{value}</dd></div>)}</dl></div>}
          {canWrite && detail.state !== "closed" && <div className="flex flex-wrap gap-2 border-y border-zinc-800 py-3">
            <Button size="sm" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate({ ticketId: detail.id, action: detail.assigneeId === me.data?.id ? { action: "unassign" } : { action: "claim" } })}>{detail.assigneeId === me.data?.id ? "Libérer" : "Me l'assigner"}</Button>
            <Button size="sm" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "set_state", state: detail.state === "pending" ? "open" : "pending" } })}>{detail.state === "pending" ? "Repasser ouvert" : "Mettre en attente"}</Button>
            <Button size="sm" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "set_priority", priority: detail.priority === "high" ? "normal" : "high" } })}>{detail.priority === "high" ? "Priorité normale" : "Priorité haute"}</Button>
          </div>}
          {canWrite && detail.state === "closed" && <div className="border-y border-zinc-800 py-3">
            <Button size="sm" variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "reopen" } })}>Rouvrir dans un nouveau salon</Button>
          </div>}
          <div><h3 className="mb-3 text-sm font-semibold text-zinc-200">Timeline</h3>{events.isPending ? <SkeletonList rows={3} /> : events.isError ? <ErrorCard message="Impossible de charger la timeline." onRetry={() => void events.refetch()} /> : events.data.length ? <div className="space-y-2">{events.data.map((event) => <div key={event.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="text-zinc-200">{EVENT_LABELS[event.type]}</span>{event.toValue && <Badge>{event.toValue}</Badge>}<span className="inline-flex items-center gap-1 text-zinc-500">par <UserCell userId={event.actorId} /> · <TimeAgo iso={event.createdAt} /></span></div>)}</div> : <p className="text-sm text-zinc-500">Aucun événement M09 pour ce ticket historique.</p>}</div>
          {detail.hasTranscript && <Button variant="secondary" onClick={() => { setTranscriptOf(detail); setDetail(null); }}>Charger le transcript</Button>}
        </div>}
      </Drawer>

      <Modal open={transcriptOf !== null} onClose={() => setTranscriptOf(null)} title={transcriptOf ? `Transcript du ticket #${String(transcriptOf.number).padStart(4, "0")}` : ""} size="2xl">
        {transcript.isPending && <SkeletonList rows={6} />}
        {transcript.isError && <ErrorCard message="Transcript introuvable." onRetry={() => void transcript.refetch()} />}
        {transcript.data && <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-xs text-zinc-300">{transcript.data.transcript}</pre>}
      </Modal>
    </Card>
  );
}
