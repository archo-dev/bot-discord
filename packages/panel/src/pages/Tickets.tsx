import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_TICKET_FORM,
  type ChannelOption,
  type MeResponse,
  type Paginated,
  type RoleOption,
  type TicketDto,
  type TicketEventDto,
  type TicketFormConfig,
  type TicketPatchAction,
  type TicketSettingsDto,
  type TicketStatsDto,
} from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
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
import { Modal } from "../ui/overlay.js";
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

export function TicketsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const settings = useQuery({
    queryKey: ["ticket-settings", guildId],
    queryFn: () => api<TicketSettingsDto>(`/api/guilds/${guildId}/tickets/settings`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
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
  const saveSettings = useMutation({
    mutationFn: () => api(`/api/guilds/${guildId}/tickets/settings`, {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        categoryId: categoryId || null,
        staffRoleIds,
        transcriptChannelId: transcriptChannelId || null,
        formEnabled,
        form,
      }),
    }),
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] }),
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

  if (settings.isPending) return <SkeletonSettingsPage cards={4} />;

  return (
    <div className="space-y-6">
      <fieldset disabled={!canWrite} className="space-y-5">
        <div className="columns-1 gap-5 xl:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
          <Card
            title="Système de tickets"
            description="Un salon privé par demande, visible par le membre et l'équipe support."
            action={<Toggle checked={enabled} onChange={setEnabled} />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Catégorie Discord des tickets">
                <ChannelSelect guildId={guildId!} value={categoryId || null} onChange={(id) => setCategoryId(id ?? "")} types={[4]} placeholder="— Choisir une catégorie —" />
              </Field>
              <Field label="Salon des transcripts (optionnel)">
                <ChannelSelect guildId={guildId!} value={transcriptChannelId || null} onChange={(id) => setTranscriptChannelId(id ?? "")} placeholder="— Aucun —" />
              </Field>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-[13px] font-medium text-zinc-300">Rôles de l'équipe support</p>
              <div className="flex flex-wrap gap-2">
                {roles.data?.filter((role) => !role.managed).map((role) => (
                  <Chip
                    key={role.id}
                    selected={staffRoleIds.includes(role.id)}
                    onClick={() => setStaffRoleIds((previous) => previous.includes(role.id) ? previous.filter((id) => id !== role.id) : [...previous, role.id])}
                  >
                    {role.name}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Panneau d'ouverture" description={settings.data?.panelChannelId ? `Panneau actuel : #${textChannels.find((channel) => channel.id === settings.data?.panelChannelId)?.name ?? settings.data.panelChannelId}` : "Publie le point d'entrée public des tickets."}>
            <div className="grid gap-4">
              <Field label="Salon"><ChannelSelect guildId={guildId!} value={panelChannelId || null} onChange={(id) => setPanelChannelId(id ?? "")} placeholder="— Choisir un salon —" /></Field>
              <Field label="Titre" error={fieldError(publishPanel.error, "title")}><Input value={panelTitle} onChange={(event) => setPanelTitle(event.target.value)} maxLength={256} /></Field>
              <Field label="Description" error={fieldError(publishPanel.error, "description")}><Textarea value={panelDescription} onChange={(event) => setPanelDescription(event.target.value)} maxLength={2000} rows={3} /></Field>
            </div>
            <div className="mt-4"><Button onClick={() => publishPanel.mutate()} disabled={!panelChannelId || dirty} loading={publishPanel.isPending}>Publier le panneau</Button></div>
            {dirty && <p className="mt-2 text-xs text-amber-300">Enregistrez les réglages avant de publier le panneau.</p>}
          </Card>
        </div>

        <Card
          title="Formulaire de triage"
          description="Jusqu'à 5 catégories et 3 questions. Les réponses restent privées et ne sont jamais utilisées dans les statistiques."
          action={<Toggle checked={formEnabled} onChange={setFormEnabled} />}
        >
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">Catégories ({form.categories.length}/5)</h3>
                <Button size="sm" variant="secondary" disabled={form.categories.length >= 5} onClick={() => setForm((previous) => ({
                  ...previous,
                  categories: [...previous.categories, { id: nextId("category", previous.categories), label: "Nouvelle catégorie", description: "", emoji: null }],
                }))}>Ajouter</Button>
              </div>
              <div className="space-y-3">
                {form.categories.map((category, index) => (
                  <div key={category.id} className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-[70px_1fr_auto]">
                    <Field label="Emoji"><Input value={category.emoji ?? ""} maxLength={16} onChange={(event) => updateCategory(index, { emoji: event.target.value || null })} /></Field>
                    <div className="grid gap-3">
                      <Field label="Nom"><Input value={category.label} maxLength={50} onChange={(event) => updateCategory(index, { label: event.target.value })} /></Field>
                      <Field label="Description"><Input value={category.description} maxLength={100} onChange={(event) => updateCategory(index, { description: event.target.value })} /></Field>
                    </div>
                    <Button variant="ghost" size="sm" disabled={form.categories.length === 1} onClick={() => setForm((previous) => ({ ...previous, categories: previous.categories.filter((_, currentIndex) => currentIndex !== index) }))}>Retirer</Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">Questions ({form.fields.length}/3)</h3>
                <Button size="sm" variant="secondary" disabled={form.fields.length >= 3} onClick={() => setForm((previous) => ({
                  ...previous,
                  fields: [...previous.fields, { id: nextId("field", previous.fields), label: "Nouvelle question", style: "short", required: false, maxLength: 120 }],
                }))}>Ajouter</Button>
              </div>
              <div className="space-y-3">
                {form.fields.length === 0 && <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">Aucune question : seule la catégorie sera demandée.</p>}
                {form.fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Question"><Input value={field.label} maxLength={45} onChange={(event) => updateField(index, { label: event.target.value })} /></Field>
                      <Field label="Format"><Select value={field.style} onChange={(event) => updateField(index, { style: event.target.value as "short" | "paragraph" })}><option value="short">Réponse courte</option><option value="paragraph">Paragraphe</option></Select></Field>
                      <Field label="Longueur maximale"><Input type="number" min={32} max={1000} value={field.maxLength} onChange={(event) => updateField(index, { maxLength: Math.min(1000, Math.max(32, Number(event.target.value) || 32)) })} /></Field>
                      <div className="flex items-end justify-between gap-3 pb-1">
                        <Toggle checked={field.required} onChange={(required) => updateField(index, { required })} label="Obligatoire" />
                        <Button variant="ghost" size="sm" onClick={() => setForm((previous) => ({ ...previous, fields: previous.fields.filter((_, currentIndex) => currentIndex !== index) }))}>Retirer</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </fieldset>

      <TicketStats guildId={guildId!} />
      <TicketList guildId={guildId!} form={settings.data?.form ?? form} canWrite={canWrite} />

      <InfoCard icon={<Icon.ticket />} title="Confidentialité et limites">
        Les réponses et transcripts sont réservés aux personnes ayant accès au panel de cette guilde et chargés à la demande. La timeline conserve uniquement des métadonnées pendant 180 jours. Sans scheduler C2.0, « vieillissant » est un indicateur visuel et n'envoie aucun rappel automatique.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={saveSettings.isPending ? "pending" : saveSettings.isError ? "error" : saveSettings.isSuccess ? "success" : "idle"}
        onSave={() => saveSettings.mutate()}
        onReset={resetForm}
      />
    </div>
  );
}

function TicketStats({ guildId }: { guildId: string }) {
  const stats = useQuery({ queryKey: ["ticket-stats", guildId], queryFn: () => api<TicketStatsDto>(`/api/guilds/${guildId}/tickets/stats`) });
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
  const [detail, setDetail] = useState<TicketDto | null>(null);
  const [transcriptOf, setTranscriptOf] = useState<TicketDto | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeResponse>("/api/me") });
  const params = new URLSearchParams({ page: String(page) });
  if (state) params.set("state", state);
  if (priority) params.set("priority", priority);
  if (assignee) params.set("assignee", assignee);
  const tickets = useQuery({
    queryKey: ["tickets", guildId, page, state, priority, assignee],
    queryFn: () => api<Paginated<TicketDto>>(`/api/guilds/${guildId}/tickets?${params.toString()}`),
  });
  const events = useQuery({
    queryKey: ["ticket-events", guildId, detail?.id],
    queryFn: () => api<TicketEventDto[]>(`/api/guilds/${guildId}/tickets/${detail!.id}/events`),
    enabled: detail !== null,
  });
  const transcript = useQuery({
    queryKey: ["ticket-transcript", guildId, transcriptOf?.id],
    queryFn: () => api<{ number: number; transcript: string }>(`/api/guilds/${guildId}/tickets/${transcriptOf!.id}/transcript`),
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

  return (
    <Card
      title={`Tickets (${tickets.data?.total ?? "…"})`}
      action={<div className="flex flex-wrap gap-2">
        <Select value={state} onChange={(event) => { setState(event.target.value as typeof state); resetPage(); }} className="h-9 w-auto"><option value="">Tous les états</option><option value="open">Ouverts</option><option value="pending">En attente</option><option value="closed">Fermés</option></Select>
        <Select value={priority} onChange={(event) => { setPriority(event.target.value as typeof priority); resetPage(); }} className="h-9 w-auto"><option value="">Toutes priorités</option><option value="high">Haute</option><option value="normal">Normale</option></Select>
        <Select value={assignee} onChange={(event) => { setAssignee(event.target.value as typeof assignee); resetPage(); }} className="h-9 w-auto"><option value="">Toute assignation</option><option value="unassigned">Non assignés</option></Select>
      </div>}
    >
      {tickets.isPending ? <SkeletonList rows={4} /> : tickets.data?.items.length === 0 ? (
        <EmptyState icon={<Icon.ticket />} title="Aucun ticket pour ces filtres" action={<Button variant="secondary" size="sm" onClick={() => { setState(""); setPriority(""); setAssignee(""); resetPage(); }}>Effacer les filtres</Button>} />
      ) : (
        <div className="divide-y divide-white/5">
          {tickets.data?.items.map((ticket) => (
            <div key={ticket.id} className="grid gap-3 py-3 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ticket.state === "open" ? "success" : ticket.state === "pending" ? "warning" : "neutral"}>{STATE_LABELS[ticket.state]}</Badge>
                {ticket.priority === "high" && <Badge tone="danger">Haute</Badge>}
                <span className="font-medium">#{String(ticket.number).padStart(4, "0")}</span>
              </div>
              <div className="min-w-0 text-zinc-400">
                <span className="inline-flex items-center gap-1.5">par <UserCell userId={ticket.userId} /> · <TimeAgo iso={ticket.createdAt} /></span>
                <span className="ml-2 text-zinc-500">· {categoryLabel(ticket.categoryKey)}</span>
                {ticket.assigneeId && <span className="ml-2 inline-flex items-center gap-1">· assigné à <UserCell userId={ticket.assigneeId} /></span>}
              </div>
              <div className="flex items-center justify-end gap-2">
                {canWrite && ticket.state !== "closed" && (
                  <Button size="sm" variant="secondary" loading={patch.isPending && detail?.id === ticket.id} onClick={() => patch.mutate({ ticketId: ticket.id, action: ticket.assigneeId === me.data?.id ? { action: "unassign" } : { action: "claim" } })}>
                    {ticket.assigneeId === me.data?.id ? "Libérer" : "Prendre"}
                  </Button>
                )}
                {canWrite && ticket.state === "closed" && (
                  <Button size="sm" variant="secondary" loading={patch.isPending && detail?.id === ticket.id} onClick={() => patch.mutate({ ticketId: ticket.id, action: { action: "reopen" } })}>
                    Rouvrir
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDetail(ticket)}>Détails</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} total={tickets.data?.total} onPage={setPage} />

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? `Ticket #${String(detail.number).padStart(4, "0")}` : ""} size="2xl">
        {detail && <div className="space-y-5">
          <div className="flex flex-wrap gap-2"><Badge tone={detail.state === "open" ? "success" : detail.state === "pending" ? "warning" : "neutral"}>{STATE_LABELS[detail.state]}</Badge><Badge tone={detail.priority === "high" ? "danger" : "neutral"}>Priorité {detail.priority === "high" ? "haute" : "normale"}</Badge><Badge>{categoryLabel(detail.categoryKey)}</Badge></div>
          {detail.formResponse && Object.keys(detail.formResponse).length > 0 && <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"><h3 className="mb-3 text-sm font-semibold text-zinc-200">Réponses privées</h3><dl className="space-y-3">{Object.entries(detail.formResponse).map(([id, value]) => <div key={id}><dt className="text-xs text-zinc-500">{form.fields.find((field) => field.id === id)?.label ?? id}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{value}</dd></div>)}</dl></div>}
          {canWrite && detail.state !== "closed" && <div className="flex flex-wrap gap-2 border-y border-zinc-800 py-3">
            <Button size="sm" variant="secondary" onClick={() => patch.mutate({ ticketId: detail.id, action: detail.assigneeId === me.data?.id ? { action: "unassign" } : { action: "claim" } })}>{detail.assigneeId === me.data?.id ? "Libérer" : "Me l'assigner"}</Button>
            <Button size="sm" variant="secondary" onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "set_state", state: detail.state === "pending" ? "open" : "pending" } })}>{detail.state === "pending" ? "Repasser ouvert" : "Mettre en attente"}</Button>
            <Button size="sm" variant="secondary" onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "set_priority", priority: detail.priority === "high" ? "normal" : "high" } })}>{detail.priority === "high" ? "Priorité normale" : "Priorité haute"}</Button>
          </div>}
          {canWrite && detail.state === "closed" && <div className="border-y border-zinc-800 py-3">
            <Button size="sm" variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ ticketId: detail.id, action: { action: "reopen" } })}>Rouvrir dans un nouveau salon</Button>
          </div>}
          <div><h3 className="mb-3 text-sm font-semibold text-zinc-200">Timeline</h3>{events.isPending ? <SkeletonList rows={3} /> : events.data?.length ? <div className="space-y-2">{events.data.map((event) => <div key={event.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="text-zinc-200">{EVENT_LABELS[event.type]}</span>{event.toValue && <Badge>{event.toValue}</Badge>}<span className="inline-flex items-center gap-1 text-zinc-500">par <UserCell userId={event.actorId} /> · <TimeAgo iso={event.createdAt} /></span></div>)}</div> : <p className="text-sm text-zinc-500">Aucun événement M09 pour ce ticket historique.</p>}</div>
          {detail.hasTranscript && <Button variant="secondary" onClick={() => { setTranscriptOf(detail); setDetail(null); }}>Charger le transcript</Button>}
        </div>}
      </Modal>

      <Modal open={transcriptOf !== null} onClose={() => setTranscriptOf(null)} title={transcriptOf ? `Transcript du ticket #${String(transcriptOf.number).padStart(4, "0")}` : ""} size="2xl">
        {transcript.isPending && <SkeletonList rows={6} />}
        {transcript.isError && <ErrorCard message="Transcript introuvable." />}
        {transcript.data && <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-xs text-zinc-300">{transcript.data.transcript}</pre>}
      </Modal>
    </Card>
  );
}
