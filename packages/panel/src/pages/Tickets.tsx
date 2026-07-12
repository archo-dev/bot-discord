import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelOption, Paginated, RoleOption, TicketDto, TicketSettingsDto } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { Badge, Button, Card, Chip, EmptyState, ErrorCard, Field, InfoCard, Input, Pagination, Textarea, Toggle } from "../ui/kit.js";
import { ChannelSelect } from "../ui/entity-select.js";
import { Modal } from "../ui/overlay.js";
import { UserCell } from "../ui/cells.js";
import { TimeAgo } from "../ui/mod-meta.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { Skeleton, SkeletonList, SkeletonSettingsPage } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

const STATUS_LABELS = { open: "Ouvert", closed: "Fermé" } as const;

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
  const [panelChannelId, setPanelChannelId] = useState("");
  const [panelTitle, setPanelTitle] = useState("Support");
  const [panelDescription, setPanelDescription] = useState(
    "Besoin d'aide ? Ouvrez un ticket et le staff vous répondra.",
  );

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.enabled);
      setCategoryId(settings.data.categoryId ?? "");
      setStaffRoleIds(settings.data.staffRoleIds);
      setTranscriptChannelId(settings.data.transcriptChannelId ?? "");
    }
  }, [settings.data]);

  const textChannels = channels.data?.filter((ch) => ch.type !== 4) ?? [];

  const saveSettings = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/tickets/settings`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          categoryId: categoryId || null,
          staffRoleIds,
          transcriptChannelId: transcriptChannelId || null,
        }),
      }),
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] }),
  });

  const publishPanel = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/tickets/panel`, {
        method: "POST",
        body: JSON.stringify({ channelId: panelChannelId, title: panelTitle, description: panelDescription }),
      }),
    meta: {
      errorMessage: "Échec de la publication — configurez d'abord la catégorie et vérifiez les permissions du bot.",
    },
    onSuccess: () => {
      toast.success(`Panneau publié dans #${textChannels.find((c) => c.id === panelChannelId)?.name ?? "le salon"}`);
      void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] });
    },
  });

  const initial = settings.data
    ? {
        enabled: settings.data.enabled,
        categoryId: settings.data.categoryId ?? "",
        staffRoleIds: [...settings.data.staffRoleIds].sort(),
        transcriptChannelId: settings.data.transcriptChannelId ?? "",
      }
    : undefined;
  const dirty = useDirty(
    { enabled, categoryId, staffRoleIds: [...staffRoleIds].sort(), transcriptChannelId },
    initial,
  );
  const resetForm = () => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setCategoryId(settings.data.categoryId ?? "");
    setStaffRoleIds(settings.data.staffRoleIds);
    setTranscriptChannelId(settings.data.transcriptChannelId ?? "");
  };

  if (settings.isPending) return <SkeletonSettingsPage cards={3} />;

  return (
    <div className="space-y-6">
      {/* fieldset disabled (M15) : réglages + publication neutralisés en lecture seule ; la liste reste consultable. */}
      <fieldset disabled={!canWrite} className="space-y-4">
      {/* M21 : les 2 cartes de config côte à côte (masonry ; la table Tickets reste pleine largeur). */}
      <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
      <Card
        title="Système de tickets"
        description="Un bouton dans un salon public ouvre un salon privé entre le membre et le staff."
        action={<Toggle checked={enabled} onChange={setEnabled} />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catégorie des tickets">
            <ChannelSelect
              guildId={guildId!}
              value={categoryId || null}
              onChange={(id) => setCategoryId(id ?? "")}
              types={[4]}
              placeholder="— Choisir une catégorie —"
            />
          </Field>
          <Field label="Salon des transcripts (optionnel)">
            <ChannelSelect
              guildId={guildId!}
              value={transcriptChannelId || null}
              onChange={(id) => setTranscriptChannelId(id ?? "")}
              placeholder="— Aucun —"
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[13px] font-medium text-zinc-300">Rôles staff (voient tous les tickets)</p>
          <div className="flex flex-wrap gap-2">
            {roles.data
              ?.filter((r) => !r.managed)
              .map((r) => (
                <Chip
                  key={r.id}
                  selected={staffRoleIds.includes(r.id)}
                  onClick={() =>
                    setStaffRoleIds((prev) =>
                      prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                    )
                  }
                >
                  {r.name}
                </Chip>
              ))}
          </div>
        </div>

      </Card>

      <Card
        title="Panneau d'ouverture"
        description={
          <>
            Publie (ou republie) le message avec le bouton « Ouvrir un ticket » dans un salon public.
            {settings.data?.panelChannelId && (
              <> Panneau actuel : salon <code>#{textChannels.find((c) => c.id === settings.data?.panelChannelId)?.name ?? settings.data.panelChannelId}</code>.</>
            )}
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Salon">
            <ChannelSelect
              guildId={guildId!}
              value={panelChannelId || null}
              onChange={(id) => setPanelChannelId(id ?? "")}
              placeholder="— Choisir un salon —"
            />
          </Field>
          <Field label="Titre" error={fieldError(publishPanel.error, "title")}>
            <Input value={panelTitle} onChange={(e) => setPanelTitle(e.target.value)} maxLength={256} />
          </Field>
          <Field label="Description" error={fieldError(publishPanel.error, "description")}>
            <Textarea
              value={panelDescription}
              onChange={(e) => setPanelDescription(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => publishPanel.mutate()} disabled={!panelChannelId} loading={publishPanel.isPending}>
            Publier le panneau
          </Button>
        </div>
      </Card>
      </div>
      </fieldset>

      <TicketList guildId={guildId!} />

      <InfoCard icon={<Icon.ticket />} title="Bon à savoir">
        Configure d'abord une <b>catégorie</b> et les rôles staff. Le bot doit pouvoir gérer les salons de cette
        catégorie (permission « Gérer les salons ») pour ouvrir et fermer les tickets.
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

function TicketList({ guildId }: { guildId: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | "open" | "closed">("");
  const [transcriptOf, setTranscriptOf] = useState<TicketDto | null>(null);

  const tickets = useQuery({
    queryKey: ["tickets", guildId, page, status],
    queryFn: () =>
      api<Paginated<TicketDto>>(`/api/guilds/${guildId}/tickets?page=${page}${status ? `&status=${status}` : ""}`),
  });
  const transcript = useQuery({
    queryKey: ["ticket-transcript", guildId, transcriptOf?.id],
    queryFn: () => api<{ number: number; transcript: string }>(`/api/guilds/${guildId}/tickets/${transcriptOf!.id}/transcript`),
    enabled: transcriptOf !== null,
  });

  const totalPages = tickets.data ? Math.max(Math.ceil(tickets.data.total / tickets.data.pageSize), 1) : 1;

  return (
    <Card
      title={`Tickets (${tickets.data?.total ?? "…"})`}
      action={
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
          className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
        >
          <option value="">Tous</option>
          <option value="open">Ouverts</option>
          <option value="closed">Fermés</option>
        </select>
      }
    >
      {tickets.isPending ? (
        <SkeletonList rows={4} />
      ) : tickets.data?.items.length === 0 ? (
        status ? (
          <EmptyState
            icon={<Icon.ticket />}
            title={`Aucun ticket ${status === "open" ? "ouvert" : "fermé"}`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setStatus("")}>
                Voir tous les tickets
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.ticket />}
            title="Aucun ticket pour le moment"
            description="Les tickets ouverts depuis le panneau publié sur Discord apparaîtront ici, avec leur transcript."
          />
        )
      ) : (
        <div className="divide-y divide-white/5">
          {tickets.data?.items.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Badge tone={t.status === "open" ? "success" : "neutral"}>{STATUS_LABELS[t.status]}</Badge>
              <span className="font-medium">#{String(t.number).padStart(4, "0")}</span>
              <span className="flex items-center gap-1.5 text-zinc-400">
                par <UserCell userId={t.userId} /> · <TimeAgo iso={t.createdAt} />
              </span>
              {t.closeReason && (
                <span className="truncate text-zinc-500" title={t.closeReason}>
                  « {t.closeReason} »
                </span>
              )}
              <span className="ml-auto flex gap-3">
                {t.hasTranscript && (
                  <button onClick={() => setTranscriptOf(t)} className="text-indigo-400 hover:underline">
                    Transcript
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} total={tickets.data?.total} onPage={setPage} />

      <Modal
        open={transcriptOf !== null}
        onClose={() => setTranscriptOf(null)}
        title={transcriptOf ? `Transcript du ticket #${String(transcriptOf.number).padStart(4, "0")}` : ""}
        size="2xl"
      >
        {transcript.isPending && <SkeletonList rows={6} />}
        {transcript.isError && <ErrorCard message="Transcript introuvable." />}
        {transcript.data && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-xs text-zinc-300">
            {transcript.data.transcript}
          </pre>
        )}
      </Modal>
    </Card>
  );
}
