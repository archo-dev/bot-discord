import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LogSettingsDto, WelcomeSettingsDto } from "@bot/shared";
import { api, fieldError } from "../lib/api.js";
import { InfoCard, Toggle } from "../ui/kit.js";
import { ChannelSelect as EntityChannelSelect } from "../ui/entity-select.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";
import { useCanWrite } from "../lib/access.js";

const MESSAGE_VARIABLES = ["{mention}", "{user}", "{user.id}", "{server}", "{membercount}"] as const;

const LOG_TOGGLES: Array<{ key: keyof Omit<LogSettingsDto, "channelId">; label: string }> = [
  { key: "memberJoin", label: "Arrivées de membres" },
  { key: "memberLeave", label: "Départs de membres" },
  { key: "messageDelete", label: "Messages supprimés" },
  { key: "messageEdit", label: "Messages modifiés" },
  { key: "memberUpdate", label: "Membres modifiés (surnom, rôles)" },
  { key: "voiceJoin", label: "Vocal — arrivées dans un salon" },
  { key: "voiceLeave", label: "Vocal — départs d'un salon" },
  { key: "voiceMove", label: "Vocal — changements de salon" },
  { key: "voiceState", label: "Vocal — muet / casque coupé" },
];

function ChannelSelect(props: { guildId: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-1">
      <EntityChannelSelect
        guildId={props.guildId}
        value={props.value || null}
        onChange={(id) => props.onChange(id ?? "")}
        placeholder="— Aucun salon —"
      />
    </div>
  );
}

function MessageEditor(props: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        maxLength={2000}
        aria-invalid={props.error ? true : undefined}
        className={`mt-1 w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm ${
          props.error ? "border-red-500/70" : "border-zinc-700"
        }`}
      />
      {props.error && <p className="mt-1 text-xs text-red-400">{props.error}</p>}
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
  const canWrite = useCanWrite();

  const welcome = useQuery({
    queryKey: ["welcome", guildId],
    queryFn: () => api<WelcomeSettingsDto>(`/api/guilds/${guildId}/welcome`),
  });
  const logs = useQuery({
    queryKey: ["log-settings", guildId],
    queryFn: () => api<LogSettingsDto>(`/api/guilds/${guildId}/log-settings`),
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
      setLogToggles(Object.fromEntries(LOG_TOGGLES.map((t) => [t.key, logs.data[t.key]])));
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
          voiceJoin: logToggles["voiceJoin"] ?? false,
          voiceLeave: logToggles["voiceLeave"] ?? false,
          voiceMove: logToggles["voiceMove"] ?? false,
          voiceState: logToggles["voiceState"] ?? false,
        }),
      });
    },
    meta: { silentError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["welcome", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["log-settings", guildId] });
    },
  });

  const initial =
    welcome.data && logs.data
      ? {
          welcomeEnabled: welcome.data.welcomeEnabled,
          welcomeChannelId: welcome.data.welcomeChannelId ?? "",
          welcomeMessage: welcome.data.welcomeMessage,
          leaveEnabled: welcome.data.leaveEnabled,
          leaveChannelId: welcome.data.leaveChannelId ?? "",
          leaveMessage: welcome.data.leaveMessage,
          logChannelId: logs.data.channelId ?? "",
          toggles: LOG_TOGGLES.map((t) => logs.data[t.key]),
        }
      : undefined;
  const dirty = useDirty(
    {
      welcomeEnabled,
      welcomeChannelId,
      welcomeMessage,
      leaveEnabled,
      leaveChannelId,
      leaveMessage,
      logChannelId,
      toggles: LOG_TOGGLES.map((t) => logToggles[t.key] ?? false),
    },
    initial,
  );
  const resetForm = () => {
    if (!welcome.data || !logs.data) return;
    setWelcomeEnabled(welcome.data.welcomeEnabled);
    setWelcomeChannelId(welcome.data.welcomeChannelId ?? "");
    setWelcomeMessage(welcome.data.welcomeMessage);
    setLeaveEnabled(welcome.data.leaveEnabled);
    setLeaveChannelId(welcome.data.leaveChannelId ?? "");
    setLeaveMessage(welcome.data.leaveMessage);
    setLogChannelId(logs.data.channelId ?? "");
    setLogToggles(Object.fromEntries(LOG_TOGGLES.map((t) => [t.key, logs.data[t.key]])));
  };

  if (welcome.isPending || logs.isPending) return <SkeletonSettingsPage cards={3} />;

  return (
    // fieldset disabled (M15) : neutralise tous les champs pour les accès lecture seule.
    <fieldset disabled={!canWrite} className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Message de bienvenue</h2>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span>Activé</span>
            <Toggle checked={welcomeEnabled} onChange={setWelcomeEnabled} />
          </div>
        </div>
        <p className="mt-1 text-sm text-zinc-400">Envoyé par le Gateway à chaque arrivée de membre.</p>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon
          <ChannelSelect guildId={guildId!} value={welcomeChannelId} onChange={setWelcomeChannelId} />
        </label>
        <label className="mt-3 block text-sm text-zinc-300">
          Message
          <MessageEditor
            value={welcomeMessage}
            onChange={setWelcomeMessage}
            error={fieldError(save.error, "welcomeMessage")}
          />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Message de départ</h2>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span>Activé</span>
            <Toggle checked={leaveEnabled} onChange={setLeaveEnabled} />
          </div>
        </div>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon
          <ChannelSelect guildId={guildId!} value={leaveChannelId} onChange={setLeaveChannelId} />
        </label>
        <label className="mt-3 block text-sm text-zinc-300">
          Message
          <MessageEditor value={leaveMessage} onChange={setLeaveMessage} error={fieldError(save.error, "leaveMessage")} />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="font-semibold">Logs serveur</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Embeds postés par le Gateway pour chaque événement coché (distinct du salon de mod-log).
        </p>
        <label className="mt-3 block text-sm text-zinc-300">
          Salon des logs
          <ChannelSelect guildId={guildId!} value={logChannelId} onChange={setLogChannelId} />
        </label>
        <div className="mt-3 divide-y divide-white/5">
          {LOG_TOGGLES.map((t) => (
            <div key={t.key} className="py-2.5 first:pt-0 last:pb-0">
              <Toggle
                label={t.label}
                checked={logToggles[t.key] ?? false}
                onChange={(v) => setLogToggles((prev) => ({ ...prev, [t.key]: v }))}
              />
            </div>
          ))}
        </div>
      </section>

      <InfoCard icon={<Icon.wave />} title="Bon à savoir">
        Variables disponibles : <code>{"{mention}"}</code> <code>{"{user}"}</code> <code>{"{server}"}</code>{" "}
        <code>{"{membercount}"}</code>. L'envoi des messages et des logs nécessite le service Gateway.
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
