import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  VARIABLES,
  type CommandAction,
  type CommandCondition,
  type CommandLogic,
  type CommandRevisionDto,
  type CustomCommandDto,
  type RoleOption,
  type ChannelOption,
} from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Toggle } from "../ui/kit.js";

const PERMISSION_OPTIONS = [
  { value: "", label: "Tout le monde" },
  { value: "8192", label: "Gérer les messages" },
  { value: "2", label: "Expulser des membres" },
  { value: "4", label: "Bannir des membres" },
  { value: "1099511627776", label: "Modérer les membres (timeout)" },
  { value: "32", label: "Gérer le serveur" },
  { value: "8", label: "Administrateur" },
] as const;

type ReplyAction = Extract<CommandAction, { type: "reply" }>;
type ExtraAction = Exclude<CommandAction, ReplyAction>;

interface FormState {
  name: string;
  description: string;
  triggerType: "slash" | "keyword";
  keywords: string;
  matchMode: "contains" | "exact" | "starts_with";
  replyContent: string;
  replyEphemeral: boolean;
  embedEnabled: boolean;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  conditions: CommandCondition[];
  conditionMode: "all" | "any";
  extraActions: ExtraAction[];
  elseReply: string;
  cooldownSeconds: number;
  cooldownScope: "user" | "guild";
  requiredPermissions: string;
}

const emptyForm: FormState = {
  name: "",
  description: "",
  triggerType: "slash",
  keywords: "",
  matchMode: "contains",
  replyContent: "",
  replyEphemeral: false,
  embedEnabled: false,
  embedTitle: "",
  embedDescription: "",
  embedColor: "#5865F2",
  conditions: [],
  conditionMode: "all",
  extraActions: [],
  elseReply: "",
  cooldownSeconds: 0,
  cooldownScope: "user",
  requiredPermissions: "",
};

function hydrate(cmd: CustomCommandDto): FormState {
  const logic = cmd.logic;
  const reply = logic.actions.find((a): a is ReplyAction => a.type === "reply");
  return {
    name: cmd.name,
    description: cmd.description,
    triggerType: logic.trigger.type,
    keywords: logic.trigger.type === "keyword" ? logic.trigger.keywords.join(", ") : "",
    matchMode: logic.trigger.type === "keyword" ? logic.trigger.matchMode : "contains",
    replyContent: reply?.content ?? "",
    replyEphemeral: reply?.ephemeral ?? false,
    embedEnabled: reply?.embed !== undefined,
    embedTitle: reply?.embed?.title ?? "",
    embedDescription: reply?.embed?.description ?? "",
    embedColor: `#${(reply?.embed?.color ?? 0x5865f2).toString(16).padStart(6, "0")}`,
    conditions: logic.conditions,
    conditionMode: logic.conditionMode,
    extraActions: logic.actions.filter((a): a is ExtraAction => a.type !== "reply"),
    elseReply: logic.elseActions[0]?.content ?? "",
    cooldownSeconds: logic.cooldown.seconds,
    cooldownScope: logic.cooldown.scope,
    requiredPermissions: logic.requiredPermissions ?? "",
  };
}

function buildLogic(f: FormState): CommandLogic {
  const actions: CommandAction[] = [];
  if (f.replyContent.trim() || f.embedEnabled) {
    actions.push({
      type: "reply",
      content: f.replyContent.trim() || undefined,
      ephemeral: f.replyEphemeral || undefined,
      embed: f.embedEnabled
        ? {
            title: f.embedTitle.trim() || undefined,
            description: f.embedDescription.trim() || undefined,
            color: parseInt(f.embedColor.replace("#", ""), 16),
          }
        : undefined,
    });
  }
  actions.push(...f.extraActions);

  return {
    version: 1,
    trigger:
      f.triggerType === "slash"
        ? { type: "slash", name: f.name }
        : {
            type: "keyword",
            name: f.name,
            keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
            matchMode: f.matchMode,
          },
    conditions: f.conditions,
    conditionMode: f.conditionMode,
    actions,
    elseActions: f.elseReply.trim() ? [{ type: "reply", content: f.elseReply.trim(), ephemeral: true }] : [],
    cooldown: { seconds: f.cooldownSeconds, scope: f.cooldownScope },
    requiredPermissions: f.requiredPermissions || null,
  };
}

// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40";
const selectCls =
  "rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40";

function ConditionRow({
  condition,
  roles,
  channels,
  onChange,
  onRemove,
}: {
  condition: CommandCondition;
  roles: RoleOption[];
  channels: ChannelOption[];
  onChange: (c: CommandCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <select
        className={selectCls}
        value={condition.type}
        onChange={(e) => {
          const type = e.target.value as CommandCondition["type"];
          if (type === "user_has_role" || type === "user_lacks_role") onChange({ type, roleId: roles[0]?.id ?? "" });
          else if (type === "channel_is") onChange({ type, channelId: channels[0]?.id ?? "" });
          else if (type === "user_has_permission") onChange({ type, permission: "8192" });
          else onChange({ type: "counter_compare", counter: "compteur", op: "gte", value: 1 });
        }}
      >
        <option value="user_has_role">A le rôle</option>
        <option value="user_lacks_role">N'a pas le rôle</option>
        <option value="channel_is">Dans le salon</option>
        <option value="user_has_permission">A la permission</option>
        <option value="counter_compare">Compteur</option>
      </select>

      {(condition.type === "user_has_role" || condition.type === "user_lacks_role") && (
        <select className={selectCls} value={condition.roleId} onChange={(e) => onChange({ ...condition, roleId: e.target.value })}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {condition.type === "channel_is" && (
        <select className={selectCls} value={condition.channelId} onChange={(e) => onChange({ ...condition, channelId: e.target.value })}>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              #{ch.name}
            </option>
          ))}
        </select>
      )}
      {condition.type === "user_has_permission" && (
        <select className={selectCls} value={condition.permission} onChange={(e) => onChange({ ...condition, permission: e.target.value })}>
          {PERMISSION_OPTIONS.filter((p) => p.value !== "").map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {condition.type === "counter_compare" && (
        <>
          <input
            className={`${selectCls} w-28`}
            value={condition.counter}
            onChange={(e) => onChange({ ...condition, counter: e.target.value })}
            placeholder="nom"
          />
          <select className={selectCls} value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as typeof condition.op })}>
            <option value="eq">=</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </select>
          <input
            type="number"
            className={`${selectCls} w-20`}
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
          />
        </>
      )}

      <button onClick={onRemove} className="ml-auto text-zinc-500 hover:text-red-400" title="Retirer">
        ✕
      </button>
    </div>
  );
}

function ActionRow({
  action,
  roles,
  channels,
  onChange,
  onRemove,
}: {
  action: ExtraAction;
  roles: RoleOption[];
  channels: ChannelOption[];
  onChange: (a: ExtraAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 p-2">
      <select
        className={selectCls}
        value={action.type}
        onChange={(e) => {
          const type = e.target.value as ExtraAction["type"];
          if (type === "send_message") onChange({ type, channelId: channels[0]?.id ?? "", content: "" });
          else if (type === "add_role" || type === "remove_role") onChange({ type, roleId: roles[0]?.id ?? "" });
          else if (type === "increment_counter") onChange({ type, counter: "compteur", amount: 1 });
          else onChange({ type: "call_webhook", url: "https://", method: "POST", includeContext: true });
        }}
      >
        <option value="send_message">Envoyer un message dans un salon</option>
        <option value="add_role">Ajouter un rôle</option>
        <option value="remove_role">Retirer un rôle</option>
        <option value="increment_counter">Incrémenter un compteur</option>
        <option value="call_webhook">Appeler un webhook externe</option>
      </select>

      {action.type === "send_message" && (
        <>
          <select className={selectCls} value={action.channelId} onChange={(e) => onChange({ ...action, channelId: e.target.value })}>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                #{ch.name}
              </option>
            ))}
          </select>
          <input
            className={`${selectCls} min-w-48 flex-1`}
            value={action.content ?? ""}
            onChange={(e) => onChange({ ...action, content: e.target.value })}
            placeholder="Message ({user}, {mention}…)"
          />
        </>
      )}
      {(action.type === "add_role" || action.type === "remove_role") && (
        <select className={selectCls} value={action.roleId} onChange={(e) => onChange({ ...action, roleId: e.target.value })}>
          {roles
            .filter((r) => !r.managed)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
      )}
      {action.type === "increment_counter" && (
        <>
          <input
            className={`${selectCls} w-32`}
            value={action.counter}
            onChange={(e) => onChange({ ...action, counter: e.target.value })}
            placeholder="nom du compteur"
          />
          <input
            type="number"
            className={`${selectCls} w-20`}
            value={action.amount}
            onChange={(e) => onChange({ ...action, amount: Number(e.target.value) })}
          />
        </>
      )}
      {action.type === "call_webhook" && (
        <>
          <input
            className={`${selectCls} min-w-64 flex-1`}
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://…"
          />
          <select className={selectCls} value={action.method} onChange={(e) => onChange({ ...action, method: e.target.value as "POST" | "GET" })}>
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input
              type="checkbox"
              className="accent-indigo-600"
              checked={action.includeContext}
              onChange={(e) => onChange({ ...action, includeContext: e.target.checked })}
            />
            contexte
          </label>
        </>
      )}

      <button onClick={onRemove} className="ml-auto text-zinc-500 hover:text-red-400" title="Retirer">
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CommandEditorPage() {
  const { guildId, commandId } = useParams<{ guildId: string; commandId?: string }>();
  const isEditing = commandId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const existing = useQuery({
    queryKey: ["command", guildId, commandId],
    queryFn: () => api<CustomCommandDto>(`/api/guilds/${guildId}/commands/${commandId}`),
    enabled: isEditing,
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const revisions = useQuery({
    queryKey: ["revisions", guildId, commandId],
    queryFn: () => api<CommandRevisionDto[]>(`/api/guilds/${guildId}/commands/${commandId}/revisions`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (existing.data) {
      const f = hydrate(existing.data);
      setForm(f);
      if (f.conditions.length > 0 || f.extraActions.length > 0 || f.cooldownSeconds > 0 || f.requiredPermissions) {
        setMode("advanced");
      }
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, description: form.description, logic: buildLogic(form) };
      return isEditing
        ? api(`/api/guilds/${guildId}/commands/${commandId}`, { method: "PUT", body: JSON.stringify(payload) })
        : api(`/api/guilds/${guildId}/commands`, { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commands", guildId] });
      void navigate(`/guilds/${guildId}/commands`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(
          err.code === "duplicate_name"
            ? "Une commande porte déjà ce nom sur ce serveur."
            : err.code.startsWith("invalid_logic")
              ? `Logique invalide : ${err.code.slice("invalid_logic: ".length)}`
              : err.code.startsWith("discord_error")
                ? `Erreur Discord : ${err.code.slice("discord_error: ".length)}`
                : "Enregistrement impossible — vérifiez le formulaire.",
        );
      } else {
        setError("Erreur réseau.");
      }
    },
  });

  const nameValid = /^[a-z0-9_-]{1,32}$/.test(form.name);
  const hasResponse = form.replyContent.trim() !== "" || form.embedEnabled;
  const canSave = nameValid && form.description.trim() !== "" && (hasResponse || form.extraActions.length > 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{isEditing ? `Modifier /${existing.data?.name ?? "…"}` : "Nouvelle commande"}</h2>
        <div className="flex rounded-lg border border-zinc-700 p-0.5">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-4 py-1.5 text-sm transition ${
                mode === m ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "simple" ? "Simple" : "Avancé"}
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">
            Nom de la commande
            <input
              className={`${inputCls} mt-1 ${form.name && !nameValid ? "border-red-700" : ""}`}
              value={form.name}
              onChange={(e) => set("name", e.target.value.toLowerCase())}
              placeholder="bienvenue"
            />
            <span className="text-xs text-zinc-500">1-32 caractères : a-z, 0-9, - et _</span>
          </label>
          <label className="text-sm text-zinc-300">
            Description
            <input
              className={`${inputCls} mt-1`}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Souhaite la bienvenue"
              maxLength={100}
            />
          </label>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm text-zinc-300">
            Déclencheur{" "}
            <select className={selectCls} value={form.triggerType} onChange={(e) => set("triggerType", e.target.value as "slash" | "keyword")}>
              <option value="slash">Slash command (/)</option>
              <option value="keyword">Mot-clé (nécessite Gateway)</option>
            </select>
          </label>
          {form.triggerType === "keyword" && (
            <>
              <input
                className={`${inputCls} flex-1`}
                value={form.keywords}
                onChange={(e) => set("keywords", e.target.value)}
                placeholder="mots-clés séparés par des virgules"
              />
              <select className={selectCls} value={form.matchMode} onChange={(e) => set("matchMode", e.target.value as FormState["matchMode"])}>
                <option value="contains">contient</option>
                <option value="exact">exact</option>
                <option value="starts_with">commence par</option>
              </select>
            </>
          )}
        </div>
        {form.triggerType === "keyword" && (
          <p className="rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
            Les déclencheurs par mot-clé seront actifs quand le service Gateway (Option B) sera déployé. La commande
            est enregistrée dès maintenant.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="font-medium">Réponse</h3>
        <textarea
          className={`${inputCls} min-h-24`}
          value={form.replyContent}
          onChange={(e) => set("replyContent", e.target.value)}
          placeholder="Bienvenue {mention} sur {server} ! Nous sommes {membercount} membres."
        />
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v.name}
              title={v.description}
              onClick={() => set("replyContent", form.replyContent + v.name)}
              className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-indigo-500 hover:text-indigo-300"
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Toggle checked={form.replyEphemeral} onChange={(v) => set("replyEphemeral", v)} />
            <span>Réponse éphémère (visible uniquement par l'utilisateur)</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Toggle checked={form.embedEnabled} onChange={(v) => set("embedEnabled", v)} />
            <span>Ajouter un embed</span>
          </div>
        </div>
        {form.embedEnabled && (
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-zinc-950 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputCls} value={form.embedTitle} onChange={(e) => set("embedTitle", e.target.value)} placeholder="Titre de l'embed" />
            <input
              className={inputCls}
              value={form.embedDescription}
              onChange={(e) => set("embedDescription", e.target.value)}
              placeholder="Description ({user}, {server}…)"
            />
            <input type="color" className="h-9 w-14 cursor-pointer rounded border border-zinc-700 bg-zinc-950" value={form.embedColor} onChange={(e) => set("embedColor", e.target.value)} />
          </div>
        )}
      </section>

      {mode === "advanced" && (
        <>
          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Conditions</h3>
              <div className="flex items-center gap-2">
                <select className={selectCls} value={form.conditionMode} onChange={(e) => set("conditionMode", e.target.value as "all" | "any")}>
                  <option value="all">Toutes requises (ET)</option>
                  <option value="any">Au moins une (OU)</option>
                </select>
                <button
                  onClick={() => set("conditions", [...form.conditions, { type: "user_has_role", roleId: roles.data?.[0]?.id ?? "" }])}
                  disabled={form.conditions.length >= 10}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
                >
                  + Condition
                </button>
              </div>
            </div>
            {form.conditions.map((cond, i) => (
              <ConditionRow
                key={i}
                condition={cond}
                roles={roles.data ?? []}
                channels={(channels.data ?? []).filter((ch) => ch.type !== 4)}
                onChange={(c) => set("conditions", form.conditions.map((x, j) => (j === i ? c : x)))}
                onRemove={() => set("conditions", form.conditions.filter((_, j) => j !== i))}
              />
            ))}
            {form.conditions.length > 0 && (
              <label className="block text-sm text-zinc-300">
                Réponse si les conditions échouent (éphémère)
                <input
                  className={`${inputCls} mt-1`}
                  value={form.elseReply}
                  onChange={(e) => set("elseReply", e.target.value)}
                  placeholder="Vous ne pouvez pas utiliser cette commande."
                />
              </label>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Actions supplémentaires (exécutées dans l'ordre)</h3>
              <button
                onClick={() =>
                  set("extraActions", [...form.extraActions, { type: "increment_counter", counter: "compteur", amount: 1 }])
                }
                disabled={form.extraActions.length >= 4}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
              >
                + Action
              </button>
            </div>
            {form.extraActions.map((action, i) => (
              <ActionRow
                key={i}
                action={action}
                roles={roles.data ?? []}
                channels={(channels.data ?? []).filter((ch) => ch.type !== 4)}
                onChange={(a) => set("extraActions", form.extraActions.map((x, j) => (j === i ? a : x)))}
                onRemove={() => set("extraActions", form.extraActions.filter((_, j) => j !== i))}
              />
            ))}
            <p className="text-xs text-zinc-500">
              Actions autorisées uniquement (liste blanche) — aucune exécution de code arbitraire.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 sm:grid-cols-3">
            <label className="text-sm text-zinc-300">
              Cooldown (secondes, 0 = aucun)
              <input
                type="number"
                min={0}
                max={86400}
                className={`${inputCls} mt-1`}
                value={form.cooldownSeconds}
                onChange={(e) => set("cooldownSeconds", Number(e.target.value))}
              />
            </label>
            <label className="text-sm text-zinc-300">
              Portée du cooldown
              <select className={`${inputCls} mt-1`} value={form.cooldownScope} onChange={(e) => set("cooldownScope", e.target.value as "user" | "guild")}>
                <option value="user">Par utilisateur</option>
                <option value="guild">Tout le serveur</option>
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Permission requise
              <select className={`${inputCls} mt-1`} value={form.requiredPermissions} onChange={(e) => set("requiredPermissions", e.target.value)}>
                {PERMISSION_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      )}

      {error && <p className="rounded-lg bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={!canSave || save.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? "Enregistrement…" : isEditing ? "Enregistrer les modifications" : "Créer la commande"}
        </button>
        <button
          onClick={() => void navigate(`/guilds/${guildId}/commands`)}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700"
        >
          Annuler
        </button>
        {!canSave && form.name && (
          <span className="text-xs text-zinc-500">Nom valide, description et au moins une réponse/action requis.</span>
        )}
      </div>

      {isEditing && revisions.data && revisions.data.length > 0 && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h3 className="font-medium">Historique des modifications</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {revisions.data.map((rev) => (
              <li key={rev.id} className="flex items-center gap-3 rounded-lg bg-zinc-950 px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    rev.changeType === "create"
                      ? "bg-green-950 text-green-300"
                      : rev.changeType === "delete"
                        ? "bg-red-950 text-red-300"
                        : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {rev.changeType}
                </span>
                <span className="text-zinc-400">
                  par <code className="text-zinc-300">{rev.changedBy}</code>
                </span>
                <span className="ml-auto text-xs text-zinc-500">{rev.changedAt} UTC</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
