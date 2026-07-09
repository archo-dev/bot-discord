import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelOption, LogSettingsDto, WelcomeSettingsDto } from "@bot/shared";
import { api } from "../lib/api.js";

const MESSAGE_VARIABLES = ["{mention}", "{user}", "{user.id}", "{server}", "{membercount}"] as const;

const LOG_TOGGLES: Array<{ key: keyof Omit<LogSettingsDto, "channelId">; label: string }> = [
  { key: "memberJoin", label: "Arrivées de membres" },
  { key: "memberLeave", label: "Départs de membres" },
  { key: "messageDelete", label: "Messages supprimés" },
  { key: "messageEdit", label: "Messages modifiés" },
  { key: "memberUpdate", label: "Membres modifiés (surnom, rôles)" },
];

function ChannelSelect(props: {
  channels: ChannelOption[] | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
    >
      <option value="">— Aucun salon —</option>
      {props.channels
        ?.filter((ch) => ch.type !== 4)
        .map((ch) => (
          <option key={ch.id} value={ch.id}>
            #{ch.name}
          </option>
        ))}
    </select>
  );
}

function MessageEditor(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        maxLength={2000}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {MESSAGE_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => props.onChange(props.value + v)}
            className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 transition hover:border-indigo-500 hover:text-indigo-300"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WelcomePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const welcome = useQuery({
    queryKey: ["welcome", guildId],
    queryFn: () => api<WelcomeSettingsDto>(`/api/guilds/${guildId}/welcome`),
  });
  const logs = useQuery({
    queryKey: ["log-settings", guildId],
    queryFn: () => api<LogSettingsDto>(`/api/guilds/${guildId}/log-settings`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });

  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeChannelId, setWelcomeChannelId] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [leaveEnabled, setLeaveEnabled] = useState(false);
  const [leaveChannelId, setLeaveChannelId] = useState("");
  const [leaveMessage, setLeaveMessage] = useState("");
  const [logChannelId, setLogChannelId] = useState("");
  const [logToggles, setLogToggles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (welcome.data) {
      setWelcomeEnabled(welcome.data.welcomeEnabled);
      setWelcomeChannelId(welcome.data.welcomeChannelId ?? "");
      setWelcomeMessage(welcome.data.welcomeMessage);
      setLeaveEnabled(welcome.data.leaveEnabled);
      setLeaveChannelId(welcome.data.leaveChannelId ?? "");
      setLeaveMessage(welcome.data.leaveMessage);
    }
  }, [welcome.data]);

  useEffect(() => {
    if (logs.data) {
      setLogChannelId(logs.data.channelId ?? "");
      setLogToggles({
        memberJoin: logs.data.memberJoin,
        memberLeave: logs.data.memberLeave,
        messageDelete: logs.data.messageDelete,
        messageEdit: logs.data.messageEdit,
        memberUpdate: logs.data.memberUpdate,
      });
    }
  }, [logs.data]);

  const save = useMutation({
    mutationFn: async () => {
      await api(`/api/guilds/${guildId}/welcome`, {
        method: "PUT",
        body: JSON.stringify({
          welcomeEnabled,
          welcomeChannelId: welcomeChannelId || null,
          welcomeMessage,
          leaveEnabled,
          leaveChannelId: leaveChannelId || null,
          leaveMessage,
        }),
      });
      await api(`/api/guilds/${guildId}/log-settings`, {
        method: "PUT",
        body: JSON.stringify({
          channelId: logChannelId || null,
          memberJoin: logToggles["memberJoin"] ?? false,
          memberLeave: logToggles["memberLeave"] ?? false,
          messageDelete: logToggles["messageDelete"] ?? false,
          messageEdit: logToggles["messageEdit"] ?? false,
          memberUpdate: logToggles["memberUpdate"] ?? false,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["welcome", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["log-settings", guildId] });
    },
  });

  if (welcome.isPending || logs.isPending) return <p className="text-zinc-400">Chargement…</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Message de bienvenue</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={welcomeEnabled} onChange={(e) => setWelcomeEnabled(e.target.checked)} />
            Activé
          </label>
        </div>
        <p className="mt-1 text-sm text-zinc-400">Envoyé par le Gateway à chaque arrivée de membre.</p>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon
          <ChannelSelect channels={channels.data} value={welcomeChannelId} onChange={setWelcomeChannelId} />
        </label>
        <label className="mt-3 block text-sm text-zinc-300">
          Message
          <MessageEditor value={welcomeMessage} onChange={setWelcomeMessage} />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Message de départ</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={leaveEnabled} onChange={(e) => setLeaveEnabled(e.target.checked)} />
            Activé
          </label>
        </div>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon
          <ChannelSelect channels={channels.data} value={leaveChannelId} onChange={setLeaveChannelId} />
        </label>
        <label className="mt-3 block text-sm text-zinc-300">
          Message
          <MessageEditor value={leaveMessage} onChange={setLeaveMessage} />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Logs serveur</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Embeds postés par le Gateway pour chaque événement coché (distinct du salon de mod-log).
        </p>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon des logs
          <ChannelSelect channels={channels.data} value={logChannelId} onChange={setLogChannelId} />
        </label>
        <div className="mt-3 space-y-2">
          {LOG_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={logToggles[t.key] ?? false}
                onChange={(e) => setLogToggles((prev) => ({ ...prev, [t.key]: e.target.checked }))}
              />
              {t.label}
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {save.isSuccess && <span className="text-sm text-green-400">✓ Enregistré</span>}
        {save.isError && <span className="text-sm text-red-400">Échec de l'enregistrement</span>}
      </div>
    </div>
  );
}
