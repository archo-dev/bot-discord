import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelOption, Paginated, RoleOption, TicketDto, TicketSettingsDto } from "@bot/shared";
import { api } from "../lib/api.js";

const STATUS_LABELS = { open: "Ouvert", closed: "Fermé" } as const;

export function TicketsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

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

  const categories = channels.data?.filter((ch) => ch.type === 4) ?? [];
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] }),
  });

  const publishPanel = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/tickets/panel`, {
        method: "POST",
        body: JSON.stringify({ channelId: panelChannelId, title: panelTitle, description: panelDescription }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ticket-settings", guildId] }),
  });

  if (settings.isPending) return <p className="text-zinc-400">Chargement…</p>;

  return (
    <div className="max-w-3xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Système de tickets</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Un bouton dans un salon public ouvre un salon privé entre le membre et le staff.
            </p>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition ${enabled ? "bg-indigo-600" : "bg-zinc-700"}`}
            aria-label="Activer les tickets"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">
            Catégorie des tickets
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="">— Choisir une catégorie —</option>
              {categories.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-300">
            Salon des transcripts (optionnel)
            <select
              value={transcriptChannelId}
              onChange={(e) => setTranscriptChannelId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="">— Aucun —</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <p className="text-sm text-zinc-300">Rôles staff (voient tous les tickets)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {roles.data
              ?.filter((r) => !r.managed)
              .map((r) => {
                const selected = staffRoleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      setStaffRoleIds((prev) => (selected ? prev.filter((id) => id !== r.id) : [...prev, r.id]))
                    }
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      selected
                        ? "border-indigo-500 bg-indigo-950 text-indigo-200"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    {r.name}
                  </button>
                );
              })}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saveSettings.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {saveSettings.isSuccess && <span className="text-sm text-green-400">✓ Enregistré</span>}
          {saveSettings.isError && <span className="text-sm text-red-400">Échec de l'enregistrement</span>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Panneau d'ouverture</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Publie (ou republie) le message avec le bouton « Ouvrir un ticket » dans un salon public.
          {settings.data?.panelChannelId && (
            <> Panneau actuel : salon <code>#{textChannels.find((c) => c.id === settings.data?.panelChannelId)?.name ?? settings.data.panelChannelId}</code>.</>
          )}
        </p>
        <div className="mt-3 grid gap-4">
          <label className="text-sm text-zinc-300">
            Salon
            <select
              value={panelChannelId}
              onChange={(e) => setPanelChannelId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="">— Choisir un salon —</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  #{ch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-300">
            Titre
            <input
              value={panelTitle}
              onChange={(e) => setPanelTitle(e.target.value)}
              maxLength={256}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-zinc-300">
            Description
            <textarea
              value={panelDescription}
              onChange={(e) => setPanelDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => publishPanel.mutate()}
            disabled={publishPanel.isPending || !panelChannelId}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {publishPanel.isPending ? "Publication…" : "Publier le panneau"}
          </button>
          {publishPanel.isSuccess && <span className="text-sm text-green-400">✓ Publié</span>}
          {publishPanel.isError && (
            <span className="text-sm text-red-400">
              Échec — configurez d'abord la catégorie, et vérifiez les permissions du bot dans le salon.
            </span>
          )}
        </div>
      </section>

      <TicketList guildId={guildId!} />
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
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Tickets ({tickets.data?.total ?? "…"})</h2>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
        >
          <option value="">Tous</option>
          <option value="open">Ouverts</option>
          <option value="closed">Fermés</option>
        </select>
      </div>

      <div className="mt-4 divide-y divide-zinc-800">
        {tickets.data?.items.length === 0 && <p className="py-4 text-sm text-zinc-500">Aucun ticket.</p>}
        {tickets.data?.items.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-3 text-sm">
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                t.status === "open" ? "bg-green-950 text-green-300" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {STATUS_LABELS[t.status]}
            </span>
            <span className="font-medium">#{String(t.number).padStart(4, "0")}</span>
            <span className="text-zinc-400">
              par <code>{t.userId}</code> · {new Date(t.createdAt + "Z").toLocaleString()}
            </span>
            {t.closeReason && <span className="truncate text-zinc-500">« {t.closeReason} »</span>}
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-zinc-400">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="rounded border border-zinc-700 px-3 py-1 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}

      {transcriptOf && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setTranscriptOf(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Transcript du ticket #{String(transcriptOf.number).padStart(4, "0")}</h3>
              <button onClick={() => setTranscriptOf(null)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>
            {transcript.isPending && <p className="text-sm text-zinc-400">Chargement…</p>}
            {transcript.isError && <p className="text-sm text-red-400">Transcript introuvable.</p>}
            {transcript.data && (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-xs text-zinc-300">
                {transcript.data.transcript}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
