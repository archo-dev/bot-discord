import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SupportTicketDetail,
  SupportTicketsListResponse,
  SupportTicketSummary,
} from "@bot/shared";
import { api } from "../../lib/api.js";
import { Badge, Button, Card, EmptyState, ErrorCard, PageHeader } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";
import { Skeleton } from "../../ui/skeleton.js";
import { formatDateTime } from "../../lib/subscription.js";
import { supportAuthorLabel, supportPriorityLabel, supportStatusLabel } from "../../lib/support.js";

/*
 * Support client (M11) — mes tickets, ouverture, fil (messages non internes),
 * réponse, fermeture. La priorité est calculée par le backend depuis le plan
 * effectif ; aucun champ priorité saisissable. Route lazy, gardée par
 * platform.support (sous l'espace client).
 */
type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: number };

function StatusBadge({ status }: { status: SupportTicketSummary["status"] }) {
  const tone = status === "closed" || status === "resolved" ? "neutral" : "primary";
  return <Badge tone={tone}>{supportStatusLabel(status)}</Badge>;
}

function TicketList({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const tickets = useQuery({
    queryKey: ["support", "tickets"],
    queryFn: () => api<SupportTicketsListResponse>("/api/support/tickets"),
    retry: false,
  });
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={onNew}>Nouveau ticket</Button>
      </div>
      {tickets.isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : tickets.isError ? (
        <ErrorCard message="Impossible de charger vos tickets." onRetry={() => void tickets.refetch()} />
      ) : tickets.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Icon.ticket />} title="Aucun ticket" description="Ouvrez un ticket pour contacter le support." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {tickets.data.items.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="w-full rounded-xl border border-(--border) bg-zinc-900/60 p-4 text-left transition-colors hover:border-indigo-500/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-100">{t.subject}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{supportPriorityLabel(t.priority)}</Badge>
                    <StatusBadge status={t.status} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Mis à jour le {formatDateTime(t.updatedAt)}
                  {t.planChangedSinceOpen && <span className="ml-2 text-amber-400">· plan modifié depuis l'ouverture</span>}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewTicket({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const create = useMutation({
    mutationFn: () => api<SupportTicketDetail>("/api/support/tickets", { method: "POST", body: JSON.stringify({ subject, body }) }),
    onSuccess: (ticket) => onCreated(ticket.id),
  });
  return (
    <Card>
      <h2 className="text-sm font-semibold text-zinc-200">Nouveau ticket</h2>
      <label className="mt-4 block text-sm text-zinc-400">
        Sujet
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          className="mt-1 w-full rounded-lg border border-(--border) bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      </label>
      <label className="mt-3 block text-sm text-zinc-400">
        Message
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={5}
          className="mt-1 w-full rounded-lg border border-(--border) bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      </label>
      {create.isError && <p className="mt-3 text-sm text-red-400">Impossible d'ouvrir le ticket.</p>}
      <div className="mt-4 flex gap-2">
        <Button size="sm" disabled={create.isPending || subject.trim().length < 3 || body.trim().length < 1} onClick={() => create.mutate()}>
          {create.isPending ? "Envoi…" : "Ouvrir le ticket"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Annuler</Button>
      </div>
    </Card>
  );
}

function TicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const ticket = useQuery({
    queryKey: ["support", "ticket", id],
    queryFn: () => api<SupportTicketDetail>(`/api/support/tickets/${id}`),
    retry: false,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["support", "ticket", id] });
    void qc.invalidateQueries({ queryKey: ["support", "tickets"] });
  };
  const sendReply = useMutation({
    mutationFn: () => api<SupportTicketDetail>(`/api/support/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body: reply }) }),
    onSuccess: () => { setReply(""); invalidate(); },
  });
  const close = useMutation({
    mutationFn: () => api<SupportTicketDetail>(`/api/support/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) }),
    onSuccess: invalidate,
  });

  return (
    <div>
      <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-400 hover:underline">← Mes tickets</button>
      {ticket.isPending ? (
        <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
      ) : ticket.isError ? (
        <ErrorCard message="Impossible de charger ce ticket." onRetry={() => void ticket.refetch()} />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold text-zinc-50">{ticket.data.subject}</h2>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{supportPriorityLabel(ticket.data.priority)}</Badge>
              <StatusBadge status={ticket.data.status} />
            </div>
          </div>
          {ticket.data.planChangedSinceOpen && (
            <p className="mt-1 text-xs text-amber-400">Votre plan a changé depuis l'ouverture — la priorité reste celle de l'ouverture.</p>
          )}
          <ul className="mt-5 space-y-3">
            {ticket.data.messages.map((m) => (
              <li key={m.id} className={`rounded-xl border border-(--border) p-3 ${m.author === "user" ? "bg-indigo-950/30" : "bg-zinc-900/60"}`}>
                <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-medium text-zinc-300">{supportAuthorLabel(m.author)}</span>
                  <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm text-zinc-200">{m.body}</p>
              </li>
            ))}
          </ul>

          {ticket.data.status !== "closed" ? (
            <div className="mt-5">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Votre réponse…"
                className="w-full rounded-lg border border-(--border) bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={sendReply.isPending || reply.trim().length < 1} onClick={() => sendReply.mutate()}>
                  {sendReply.isPending ? "Envoi…" : "Répondre"}
                </Button>
                <Button size="sm" variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>
                  {close.isPending ? "…" : "Fermer le ticket"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-zinc-500">Ce ticket est fermé.</p>
          )}
        </>
      )}
    </div>
  );
}

export function SupportPage() {
  const [view, setView] = useState<View>({ kind: "list" });
  useEffect(() => {
    document.title = "Support — Panel du bot";
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader eyebrow="Espace client" title="Support" description="Vos demandes d'assistance, priorisées selon votre offre." />
      <div className="mt-6">
        {view.kind === "list" && <TicketList onOpen={(id) => setView({ kind: "detail", id })} onNew={() => setView({ kind: "new" })} />}
        {view.kind === "new" && <NewTicket onCreated={(id) => setView({ kind: "detail", id })} onCancel={() => setView({ kind: "list" })} />}
        {view.kind === "detail" && <TicketDetail id={view.id} onBack={() => setView({ kind: "list" })} />}
      </div>
    </main>
  );
}
