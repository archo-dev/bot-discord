import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModActionDto, Paginated, PanelSanctionType, RoleOption, SanctionExemptionsDto, WarningDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { MemberCombobox } from "../ui/entity-select.js";
import { UserCell } from "../ui/cells.js";
import { Badge, Button, Card, EmptyState, ErrorCard, Field, InfoCard, Input, Pagination, Select, Tabs, TableWrap, Textarea } from "../ui/kit.js";
import { ConfirmModal, Drawer } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../ui/mod-meta.js";
import { Icon } from "../ui/icons.js";

const TYPES: { value: "" | PanelSanctionType; label: string }[] = [
  { value: "", label: "Tous les types" }, { value: "warn", label: "Avertissement" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "Expulsion" }, { value: "ban", label: "Bannissement" },
];
// The unified history filters by any recorded action, not only the four panel
// sanction types, so a Discord /unban or an auto-mod mute is reachable too.
const ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "Toutes les actions" }, { value: "ban", label: "Ban" }, { value: "unban", label: "Unban" }, { value: "kick", label: "Kick" },
  { value: "timeout", label: "Mute" }, { value: "auto_timeout", label: "Mute auto" }, { value: "warn", label: "Warn" }, { value: "unwarn", label: "Warn révoqué" }, { value: "clear", label: "Clear" },
];
const SOURCES: { value: string; label: string }[] = [
  { value: "", label: "Toutes les sources" }, { value: "interaction", label: "Discord" }, { value: "panel", label: "Panel" }, { value: "gateway", label: "Auto-mod" },
];
const STATUS = ["", "active", "expired", "revoked", "failed"] as const;
const statusLabel: Record<(typeof STATUS)[number], string> = { "": "Tous les états", active: "Actif", expired: "Expiré", revoked: "Révoqué", failed: "Échoué" };
const typeLabel: Record<PanelSanctionType, string> = { warn: "Avertissement", timeout: "Timeout", kick: "Expulsion", ban: "Bannissement" };
const sourceLabel = (source: ModActionDto["source"]): string => source === "interaction" ? "Discord" : source === "gateway" ? "Auto-mod / Gateway" : "Panel";
const REVOCABLE = new Set(["ban", "timeout", "auto_timeout", "warn"]);

/** Unified moderation history — the single mod_actions source, fully filtered
 *  server-side (supersedes the former Sanctions and Mod-log duplicate tables). */
function AllActions() {
  const { guildId } = useParams<{ guildId: string }>();
  const client = useQueryClient();
  const canWrite = useCanWrite();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [status, setStatus] = useState<(typeof STATUS)[number]>("");
  const [source, setSource] = useState("");
  const [member, setMember] = useState<string | null>(null);
  const [moderator, setModerator] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<ModActionDto | null>(null);
  const [toRevoke, setToRevoke] = useState<ModActionDto | null>(null);
  const reset = () => setPage(1);
  const query = new URLSearchParams({ page: String(page) });
  if (action) query.set("action", action);
  if (status) query.set("status", status);
  if (source) query.set("source", source);
  if (member) query.set("target", member);
  if (moderator) query.set("moderator", moderator);
  if (search.trim()) query.set("q", search.trim());
  if (from) query.set("from", from);
  if (to) query.set("to", `${to} 23:59:59`); // inclusive end of the selected day (created_at = "YYYY-MM-DD HH:MM:SS")
  const history = useQuery({ queryKey: ["mod-actions", guildId, query.toString()], queryFn: () => api<Paginated<ModActionDto>>(`/api/guilds/${guildId}/mod-actions?${query}`) });
  const revoke = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/sanctions/${id}/revoke`, { method: "POST", body: JSON.stringify({}) }),
    meta: { successMessage: "Sanction révoquée" },
    onSuccess: () => { setToRevoke(null); void client.invalidateQueries({ queryKey: ["mod-actions", guildId] }); void client.invalidateQueries({ queryKey: ["warnings", guildId] }); },
  });
  const totalPages = history.data ? Math.max(1, Math.ceil(history.data.total / history.data.pageSize)) : 1;
  return <div className="space-y-4">
    <Card title="Historique de modération" description="Toutes les actions (Discord, panel et auto-mod) au même endroit. Filtres, recherche et pagination exécutés côté serveur.">
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select aria-label="Action" value={action} onChange={(event) => { setAction(event.target.value); reset(); }}><>{ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</></Select>
        <Select aria-label="État" value={status} onChange={(event) => { setStatus(event.target.value as (typeof STATUS)[number]); reset(); }}><>{STATUS.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</></Select>
        <Select aria-label="Source" value={source} onChange={(event) => { setSource(event.target.value); reset(); }}><>{SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</></Select>
        <Input aria-label="Recherche dans la raison" value={search} onChange={(event) => { setSearch(event.target.value); reset(); }} placeholder="Rechercher une raison…" />
        <MemberCombobox guildId={guildId!} value={member} onChange={(id) => { setMember(id); reset(); }} placeholder="Membre concerné…" />
        <MemberCombobox guildId={guildId!} value={moderator} onChange={(id) => { setModerator(id); reset(); }} placeholder="Modérateur…" />
        <Input aria-label="Depuis le" type="date" value={from} onChange={(event) => { setFrom(event.target.value); reset(); }} />
        <Input aria-label="Jusqu'au" type="date" value={to} onChange={(event) => { setTo(event.target.value); reset(); }} />
      </div>
      {history.isPending ? <SkeletonList rows={6} /> : history.isError ? <ErrorCard message="Impossible de charger l'historique de modération." onRetry={() => void history.refetch()} /> : (history.data?.items.length ?? 0) === 0 ? <EmptyState icon={<Icon.shield />} title="Aucune action trouvée" description="Les actions appliquées depuis Discord, l'auto-modération ou le panel apparaîtront ici." /> : <>
        <TableWrap><thead><tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Membre</th><th className="py-2 pr-3">Modérateur</th><th className="py-2 pr-3">Raison</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">État</th><th className="py-2 text-right">Date</th></tr></thead><tbody className="divide-y divide-white/5">{history.data!.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-(--state-hover)" onClick={() => setDetail(item)}><td className="py-2.5 pr-3"><span className="flex items-center gap-2"><ModActionIcon action={item.action} size={28} /><span className="font-medium text-zinc-100">{actionMeta(item.action).label}</span></span></td><td className="py-2.5 pr-3">{item.targetId ? <UserCell userId={item.targetId} /> : <span className="text-zinc-600">—</span>}</td><td className="py-2.5 pr-3"><UserCell userId={item.moderatorId} /></td><td className="max-w-[16rem] truncate py-2.5 pr-3 text-sm text-zinc-400" title={item.reason ?? undefined}>{item.reason ?? "—"}</td><td className="py-2.5 pr-3 text-sm text-zinc-400">{sourceLabel(item.source)}</td><td className="py-2.5 pr-3"><Badge tone={item.status === "active" ? "success" : item.status === "revoked" ? "neutral" : item.status === "failed" ? "danger" : "warning"}>{statusLabel[item.status]}</Badge></td><td className="py-2.5 text-right text-zinc-500"><TimeAgo iso={item.createdAt} /></td></tr>)}</tbody></TableWrap>
        <Pagination page={page} totalPages={totalPages} total={history.data?.total} onPage={setPage} />
      </>}
    </Card>
    <Drawer open={detail !== null} onClose={() => setDetail(null)} title={detail ? `Détail de l'action #${detail.id}` : "Détail de l'action"}>{detail && <><dl className="grid gap-4 text-sm"><div><dt className="text-zinc-500">Action</dt><dd className="mt-1 flex items-center gap-2 text-zinc-200"><ModActionIcon action={detail.action} size={24} />{actionMeta(detail.action).label}</dd></div><div><dt className="text-zinc-500">Membre</dt><dd className="mt-1">{detail.targetId ? <UserCell userId={detail.targetId} /> : <span className="text-zinc-400">—</span>}</dd></div><div><dt className="text-zinc-500">Modérateur</dt><dd className="mt-1"><UserCell userId={detail.moderatorId} /></dd></div><div><dt className="text-zinc-500">Source</dt><dd className="mt-1 text-zinc-200">{sourceLabel(detail.source)}</dd></div><div><dt className="text-zinc-500">Raison</dt><dd className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{detail.reason ?? "—"}</dd></div><div><dt className="text-zinc-500">État</dt><dd className="mt-1"><Badge tone={detail.status === "active" ? "success" : detail.status === "revoked" ? "neutral" : detail.status === "failed" ? "danger" : "warning"}>{statusLabel[detail.status]}</Badge></dd></div><div><dt className="text-zinc-500">Date</dt><dd className="mt-1 text-zinc-200">{new Date(detail.createdAt.endsWith("Z") ? detail.createdAt : `${detail.createdAt.replace(" ", "T")}Z`).toLocaleString("fr-FR")}</dd></div><div><dt className="text-zinc-500">Expiration</dt><dd className="mt-1 text-zinc-200">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleString("fr-FR") : "Non applicable"}</dd></div>{detail.revokedAt && <><div><dt className="text-zinc-500">Révoquée le</dt><dd className="mt-1 text-zinc-200">{new Date(detail.revokedAt.endsWith("Z") ? detail.revokedAt : `${detail.revokedAt.replace(" ", "T")}Z`).toLocaleString("fr-FR")}</dd></div><div><dt className="text-zinc-500">Par</dt><dd className="mt-1"><UserCell userId={detail.revokedBy ?? "system"} /></dd></div>{detail.revocationReason && <div><dt className="text-zinc-500">Raison de la révocation</dt><dd className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{detail.revocationReason}</dd></div>}</>}</dl>{canWrite && detail.status === "active" && REVOCABLE.has(detail.action) && <div className="mt-5 border-t border-zinc-800 pt-4"><Button variant="danger" size="sm" onClick={() => setToRevoke(detail)}>Révoquer cette sanction</Button></div>}</>}</Drawer>
    <ConfirmModal open={toRevoke !== null} title="Révoquer cette sanction ?" subject={<>La révocation de <b className="text-zinc-100">{toRevoke && actionMeta(toRevoke.action).label}</b> sera appliquée sur Discord lorsque c'est possible.</>} consequence="L'action est journalisée et l'état de la sanction sera mis à jour." confirmLabel="Révoquer" loading={revoke.isPending} onCancel={() => setToRevoke(null)} onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)} />
  </div>;
}

/** Warnings lens over the dedicated warnings table (per-warning revoke feeds the
 *  auto-mute threshold) — a legitimate second view, not a duplicate row. */
function Warnings() {
  const { guildId } = useParams<{ guildId: string }>();
  const client = useQueryClient();
  const canWrite = useCanWrite();
  const [userFilter, setUserFilter] = useState("");
  const [toRevoke, setToRevoke] = useState<WarningDto | null>(null);
  const warnings = useQuery({ queryKey: ["warnings", guildId, userFilter], queryFn: () => api<WarningDto[]>(`/api/guilds/${guildId}/warnings${userFilter ? `?userId=${userFilter}` : ""}`) });
  const revoke = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/warnings/${id}`, { method: "DELETE" }),
    meta: { successMessage: "Avertissement révoqué" },
    onSuccess: () => { setToRevoke(null); void client.invalidateQueries({ queryKey: ["warnings", guildId] }); void client.invalidateQueries({ queryKey: ["mod-actions", guildId] }); },
  });
  const items = warnings.data ?? [];
  return <Card title="Avertissements" description="Chaque avertissement alimente le seuil de warns → mute automatique. Révoquer un warn le retire du décompte actif." action={<div className="w-56 sm:w-64"><MemberCombobox guildId={guildId!} value={userFilter || null} onChange={(id) => setUserFilter(id ?? "")} placeholder="Filtrer par membre…" /></div>}>
    {warnings.isPending ? <SkeletonList rows={4} /> : warnings.isError ? <ErrorCard message="Impossible de charger les avertissements." onRetry={() => void warnings.refetch()} /> : items.length === 0 ? (userFilter ? <EmptyState icon={<Icon.shield />} title="Aucun avertissement pour ce membre" action={<Button variant="secondary" size="sm" onClick={() => setUserFilter("")}>Effacer le filtre</Button>} /> : <EmptyState icon={<Icon.shield />} title="Aucun avertissement" description="Les avertissements donnés avec /warn apparaîtront ici, avec leur statut actif ou révoqué." />) : <TableWrap><thead><tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-4">#</th><th className="py-2 pr-4">Membre</th><th className="py-2 pr-4">Raison</th><th className="py-2 pr-4">Par</th><th className="py-2 pr-4">Date</th><th className="py-2 pr-4 text-right">État</th></tr></thead><tbody className="divide-y divide-white/5">{items.map((w) => <tr key={w.id} className={w.revokedAt ? "opacity-50" : ""}><td className="py-2.5 pr-4 text-zinc-500">#{w.id}</td><td className="py-2.5 pr-4"><UserCell userId={w.userId} /></td><td className="max-w-[16rem] truncate py-2.5 pr-4 text-zinc-400" title={w.reason ?? undefined}>{w.reason ?? "—"}</td><td className="py-2.5 pr-4"><UserCell userId={w.moderatorId} /></td><td className="whitespace-nowrap py-2.5 pr-4 text-zinc-500"><TimeAgo iso={w.createdAt} /></td><td className="py-2.5 pr-4 text-right">{w.revokedAt ? <Badge tone="neutral">Révoqué</Badge> : canWrite ? <Button size="sm" variant="secondary" onClick={() => setToRevoke(w)}>Révoquer</Button> : <Badge tone="success">Actif</Badge>}</td></tr>)}</tbody></TableWrap>}
    <ConfirmModal open={toRevoke !== null} title="Révoquer cet avertissement ?" subject={<>L'avertissement <b className="text-zinc-100">#{toRevoke?.id}</b> sera retiré du décompte actif du membre.</>} consequence="La révocation est enregistrée dans l'historique et ne peut pas être annulée." confirmLabel="Révoquer" loading={revoke.isPending} onCancel={() => setToRevoke(null)} onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)} />
  </Card>;
}

function Settings() {
  const { guildId } = useParams<{ guildId: string }>(); const canWrite = useCanWrite(); const client = useQueryClient(); const [filter, setFilter] = useState("");
  const exemptions = useQuery({ queryKey: ["sanction-exemptions", guildId], queryFn: () => api<SanctionExemptionsDto>(`/api/guilds/${guildId}/sanction-exemptions`) });
  const roles = useQuery({ queryKey: ["roles", guildId], queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`) });
  const [draft, setDraft] = useState<SanctionExemptionsDto | null>(null);
  const value = draft ?? exemptions.data ?? { warn: [], timeout: [], kick: [], ban: [] };
  const save = useMutation({ mutationFn: () => api(`/api/guilds/${guildId}/sanction-exemptions`, { method: "PUT", body: JSON.stringify(value) }), meta: { successMessage: "Exemptions enregistrées" }, onSuccess: () => { setDraft(null); void client.invalidateQueries({ queryKey: ["sanction-exemptions", guildId] }); } });
  const knownRoles = new Set((roles.data ?? []).map((role) => role.id)); const visible = useMemo(() => (roles.data ?? []).filter((role) => role.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => b.position - a.position), [roles.data, filter]);
  const toggle = (type: PanelSanctionType, roleId: string) => setDraft({ ...value, [type]: value[type].includes(roleId) ? value[type].filter((id) => id !== roleId) : [...value[type], roleId] });
  if (exemptions.isPending || roles.isPending) return <SkeletonList rows={6} />; if (exemptions.isError || roles.isError) return <ErrorCard message="Impossible de charger les exemptions ou les rôles." onRetry={() => { void exemptions.refetch(); void roles.refetch(); }} />;
  return <div className="max-w-5xl space-y-4"><Card title="Rôles exemptés" description="Chaque type de sanction possède sa propre liste. Les rôles supprimés restent signalés afin qu'aucune protection ne disparaisse silencieusement."><div className="mb-4 max-w-md"><Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Rechercher un rôle…" /></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Rôle</th>{(["warn", "timeout", "kick", "ban"] as const).map((type) => <th key={type} className="px-2 py-2 text-center">{typeLabel[type]}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{visible.map((role) => <tr key={role.id}><td className="py-2.5 pr-3"><span className="inline-flex items-center gap-2 text-zinc-200"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#99aab5" }} />{role.name}<span className="text-xs text-zinc-500">position {role.position}{role.managed ? " · intégration" : ""}</span></span></td>{(["warn", "timeout", "kick", "ban"] as const).map((type) => <td key={type} className="px-2 py-2 text-center"><input aria-label={`${typeLabel[type]} : ${role.name}`} type="checkbox" disabled={!canWrite} checked={value[type].includes(role.id)} onChange={() => toggle(type, role.id)} /></td>)}</tr>)}</tbody></table></div>{(["warn", "timeout", "kick", "ban"] as const).flatMap((type) => value[type].filter((id) => !knownRoles.has(id)).map((id) => <p key={`${type}-${id}`} className="mt-2 text-sm text-amber-300">Rôle introuvable ({id}) encore exempté pour {typeLabel[type]}.</p>))}<div className="mt-5 flex justify-end"><Button disabled={!canWrite || save.isPending} onClick={() => save.mutate()}>Enregistrer les exemptions</Button></div></Card><InfoCard icon={<Icon.shield />} title="Protections prioritaires">Les exemptions ne remplacent jamais les protections Discord : propriétaire, auto-sanction, hiérarchie, permissions du bot et de l'auteur restent vérifiés côté serveur.</InfoCard></div>;
}

/** Main tab « Historique » : Toutes les actions / Avertissements + a Paramètres
 *  button that swaps to exemptions in place (no extra navigation level). */
export function ModerationHistoryPage() {
  const [section, setSection] = useState<"history" | "settings">("history");
  const [view, setView] = useState<"actions" | "warnings">("actions");
  if (section === "settings") {
    return <div className="space-y-4"><div><Button variant="secondary" size="sm" onClick={() => setSection("history")}>← Retour à l'historique</Button></div><Settings /></div>;
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs<"actions" | "warnings"> active={view} onChange={setView} tabs={[{ id: "actions", label: "Toutes les actions" }, { id: "warnings", label: "Avertissements" }]} />
      <Button variant="secondary" size="sm" onClick={() => setSection("settings")}><Icon.sliders /> Paramètres</Button>
    </div>
    {view === "actions" ? <AllActions /> : <Warnings />}
  </div>;
}

/** Main tab « Appliquer une sanction ». */
export function ApplySanctionPage() {
  const { guildId } = useParams<{ guildId: string }>(); const client = useQueryClient(); const canWrite = useCanWrite();
  const [targetId, setTargetId] = useState<string | null>(null); const [type, setType] = useState<PanelSanctionType>("warn"); const [reason, setReason] = useState(""); const [minutes, setMinutes] = useState(60); const [confirm, setConfirm] = useState(false);
  const expiry = type === "timeout" ? new Date(Date.now() + minutes * 60_000).toLocaleString("fr-FR") : null;
  const create = useMutation({ mutationFn: () => api(`/api/guilds/${guildId}/sanctions`, { method: "POST", body: JSON.stringify({ type, targetId, reason, ...(type === "timeout" ? { durationMinutes: minutes } : {}), idempotencyKey: crypto.randomUUID() }) }), meta: { successMessage: "Sanction appliquée" }, onSuccess: () => { setConfirm(false); setReason(""); void client.invalidateQueries({ queryKey: ["mod-actions", guildId] }); void client.invalidateQueries({ queryKey: ["warnings", guildId] }); } });
  const canSubmit = canWrite && !!targetId && reason.trim().length > 0 && (type !== "timeout" || (minutes >= 1 && minutes <= 40_320));
  return <div className="max-w-3xl space-y-4"><Card title="Appliquer une sanction" description="Les protections Discord, la hiérarchie, les exemptions et les permissions sont à nouveau vérifiées par le serveur au moment de l'action."><div className="grid gap-4 sm:grid-cols-2"><Field label="Membre"><MemberCombobox guildId={guildId!} value={targetId} onChange={setTargetId} placeholder="Rechercher le membre à sanctionner…" /></Field><Field label="Type de sanction"><Select value={type} onChange={(event) => setType(event.target.value as PanelSanctionType)}>{TYPES.slice(1).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><div className="sm:col-span-2"><Field label="Raison" hint="Obligatoire, 512 caractères maximum."><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} /></Field></div>{type === "timeout" && <Field label="Durée (minutes)" hint={expiry ? `Expiration : ${expiry}` : undefined}><Input type="number" min={1} max={40320} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></Field>}</div><div className="mt-5 flex justify-end"><Button disabled={!canSubmit} onClick={() => setConfirm(true)}>Continuer</Button></div>{!canWrite && <p className="mt-3 text-sm text-amber-300">Votre niveau d'accès permet la consultation, pas l'application de sanctions.</p>}</Card><InfoCard icon={<Icon.shield />} title="Actions irréversibles">Une expulsion ne peut pas être annulée. Un bannissement retire le membre et empêche son retour tant qu'il n'est pas révoqué.</InfoCard><ConfirmModal open={confirm} title={type === "ban" ? "Bannir ce membre ?" : "Confirmer la sanction ?"} subject={type === "ban" ? <>Vous êtes sur le point de bannir cet utilisateur. Cette action le retirera du serveur et empêchera son retour tant que le ban ne sera pas révoqué.</> : <>La sanction <b className="text-zinc-100">{typeLabel[type]}</b> sera appliquée au membre sélectionné.</>} consequence={expiry ? `Le timeout expirera le ${expiry}.` : type === "kick" ? "Une expulsion n'est pas révocable." : "Cette action est enregistrée dans l'historique de modération."} confirmLabel={type === "ban" ? "Bannir" : "Appliquer la sanction"} loading={create.isPending} onCancel={() => setConfirm(false)} onConfirm={() => create.mutate()} /></div>;
}
