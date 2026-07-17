import { useState } from "react";
import { useParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ChannelOption, VoiceLogAction, VoiceLogDto, VoiceLogPage } from "@bot/shared";
import { api } from "../lib/api.js";
import { Button, Card, EmptyState, ErrorCard, InfoCard, Input, Select, TableWrap, Toolbar } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonList } from "../ui/skeleton.js";
import { UserCell } from "../ui/cells.js";
import { MemberCombobox, ChannelSelect } from "../ui/entity-select.js";
import { TimeAgo } from "../ui/mod-meta.js";

const ACTION_META: Record<VoiceLogAction, { label: string; emoji: string }> = {
  join: { label: "Arrivée", emoji: "🔊" },
  leave: { label: "Départ", emoji: "🔴" },
  move: { label: "Changement", emoji: "➡️" },
  mute: { label: "Muet", emoji: "🔇" },
  unmute: { label: "Démuet", emoji: "🎙️" },
  deafen: { label: "Casque coupé", emoji: "🙉" },
  undeafen: { label: "Casque réactivé", emoji: "🔊" },
};

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Toutes les actions" },
  { value: "join", label: "Arrivée" },
  { value: "leave", label: "Départ" },
  { value: "move", label: "Changement de salon" },
  { value: "mute", label: "Muet" },
  { value: "unmute", label: "Démuet" },
  { value: "deafen", label: "Casque coupé" },
  { value: "undeafen", label: "Casque réactivé" },
];

export function VoiceLogPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [userId, setUserId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
    staleTime: 60_000,
  });
  const channelName = (id: string | null) =>
    id ? (channels.data?.find((c) => c.id === id)?.name ?? id) : null;

  const logs = useInfiniteQuery({
    queryKey: ["voice-logs", guildId, { userId, channelId, action, from, to }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (userId) params.set("userId", userId);
      if (channelId) params.set("channelId", channelId);
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (pageParam) params.set("cursor", pageParam);
      return api<VoiceLogPage>(`/api/guilds/${guildId}/voice-logs?${params.toString()}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = logs.data?.pages.flatMap((p) => p.items) ?? [];
  const hasFilters = Boolean(userId || channelId || action || from || to);
  const resetFilters = () => {
    setUserId("");
    setChannelId("");
    setAction("");
    setFrom("");
    setTo("");
  };

  const channelCell = (log: VoiceLogDto) => {
    const to = channelName(log.channelId);
    if (log.action === "move") {
      const fromName = channelName(log.fromChannelId);
      return (
        <span className="text-zinc-300">
          🔊 {fromName ?? "?"} <span className="text-zinc-600">→</span> 🔊 {to ?? "?"}
        </span>
      );
    }
    return to ? <span className="text-zinc-300">🔊 {to}</span> : <span className="text-zinc-600">—</span>;
  };

  return (
    // M21 : largeur bornée — une table 4 colonnes s'étale et paraît vide sur 1600 px.
    <div className="max-w-5xl space-y-4">
      <Card
        title="Historique vocal"
        description="Arrivées, départs et déplacements en vocal — indépendants du salon de logs. Nécessite le service Gateway."
      >
        <Toolbar className="mb-4">
          <div className="w-56">
            <MemberCombobox guildId={guildId!} value={userId || null} onChange={(id) => setUserId(id ?? "")} placeholder="Filtrer par membre…" />
          </div>
          <div className="w-52">
            <ChannelSelect guildId={guildId!} value={channelId || null} onChange={(id) => setChannelId(id ?? "")} types={[2, 13]} placeholder="Filtrer par salon…" />
          </div>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="sm:max-w-52">
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="[color-scheme:dark] sm:max-w-40" aria-label="Depuis" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="[color-scheme:dark] sm:max-w-40" aria-label="Jusqu'à" />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Réinitialiser
            </Button>
          )}
        </Toolbar>

        {logs.isPending ? (
          <SkeletonList rows={6} />
        ) : logs.isError ? (
          <ErrorCard message="Impossible de charger l'historique vocal." onRetry={() => void logs.refetch()} />
        ) : items.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<Icon.scroll />}
              title="Aucun résultat pour ces filtres"
              action={
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon.scroll />}
              title="Aucune activité vocale enregistrée"
              description="Les arrivées et départs en vocal apparaîtront ici dès que le service Gateway sera actif."
            />
          )
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-semibold">Action</th>
                  <th className="py-2 pr-4 font-semibold">Membre</th>
                  <th className="py-2 pr-4 font-semibold">Salon</th>
                  <th className="py-2 pr-4 text-right font-semibold">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((log) => (
                  <tr key={log.id} className="align-middle">
                    <td className="py-2.5 pr-4">
                      <span className="font-semibold text-zinc-100">
                        {ACTION_META[log.action].emoji} {ACTION_META[log.action].label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <UserCell userId={log.userId} />
                    </td>
                    <td className="py-2.5 pr-4">{channelCell(log)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-right text-zinc-500">
                      <TimeAgo iso={log.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            {logs.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => void logs.fetchNextPage()} loading={logs.isFetchingNextPage}>
                  Charger plus
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <InfoCard icon={<Icon.scroll />} title="Bon à savoir">
        Les arrivées, départs et changements de salon sont toujours enregistrés ici. Les changements d'état (muet,
        casque) ne le sont que si l'option « Vocal — muet / casque coupé » est activée dans la page Bienvenue. Les
        embeds dans le salon de logs suivent chaque interrupteur.
      </InfoCard>
    </div>
  );
}
