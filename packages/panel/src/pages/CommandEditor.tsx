/* Page éditeur de commande custom (création/édition, mode simple + avancé).
 * La logique de formulaire et les lignes condition/action vivent dans ./command-editor/. */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  VARIABLES,
  type CommandRevisionDto,
  type CustomCommandDto,
  type RoleOption,
  type ChannelOption,
} from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Button, Toggle } from "../ui/kit.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { TimeAgo } from "../ui/mod-meta.js";
import { useCanWrite } from "../lib/access.js";
import { PERMISSION_OPTIONS, buildLogic, emptyForm, hydrate, inputCls, selectCls, type FormState } from "./command-editor/logic.js";
import { ConditionRow } from "./command-editor/ConditionRow.js";
import { ActionRow } from "./command-editor/ActionRow.js";

export function CommandEditorPage() {
  const { guildId, commandId } = useParams<{ guildId: string; commandId?: string }>();
  const isEditing = commandId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

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
    // L'erreur est affichée dans la page (bloc rouge) : pas de toast global en doublon
    meta: {
      successMessage: isEditing ? `Commande /${form.name} enregistrée` : `Commande /${form.name} créée`,
      silentError: true,
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commands", guildId] });
      void navigate(`/guilds/${guildId}/commands`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // duplicate_name s'affiche sous le champ Nom (E5), pas dans le bloc global
        if (err.code === "duplicate_name") return;
        setError(
          err.code.startsWith("invalid_logic")
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

  const nameError =
    save.error instanceof ApiError && save.error.code === "duplicate_name"
      ? "Une commande porte déjà ce nom sur ce serveur."
      : undefined;
  const nameValid = /^[a-z0-9_-]{1,32}$/.test(form.name);
  const hasResponse = form.replyContent.trim() !== "" || form.embedEnabled;
  const canSave = nameValid && form.description.trim() !== "" && (hasResponse || form.extraActions.length > 0);

  if (isEditing && existing.isPending) return <SkeletonSettingsPage cards={2} />;

  return (
    <div className="max-w-4xl space-y-6">
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

      {/* fieldset disabled (M15) : tous les champs neutralisés en lecture seule ; l'en-tête (Simple/Avancé) et « Annuler » restent actifs. */}
      <fieldset disabled={!canWrite} className="space-y-6">
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">
            Nom de la commande
            <input
              className={`${inputCls} mt-1 ${(form.name && !nameValid) || nameError ? "border-red-700" : ""}`}
              value={form.name}
              onChange={(e) => set("name", e.target.value.toLowerCase())}
              placeholder="bienvenue"
              aria-invalid={nameError ? true : undefined}
            />
            {nameError ? (
              <span className="text-xs text-red-400">{nameError}</span>
            ) : (
              <span className="text-xs text-zinc-500">1-32 caractères : a-z, 0-9, - et _</span>
            )}
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
      </fieldset>

      {error && <p className="rounded-lg bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        {canWrite && (
        <Button
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={!canSave}
          loading={save.isPending}
        >
          {isEditing ? "Enregistrer les modifications" : "Créer la commande"}
        </Button>
        )}
        <Button variant="secondary" onClick={() => void navigate(`/guilds/${guildId}/commands`)}>
          {canWrite ? "Annuler" : "Retour"}
        </Button>
        {canWrite && !canSave && form.name && (
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
                <TimeAgo iso={rev.changedAt} className="ml-auto text-xs text-zinc-500" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
