import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModActionDto, Paginated, PanelSanctionType, RoleOption, SanctionExemptionsDto } from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { MemberCombobox } from "../ui/entity-select.js";
import { UserCell } from "../ui/cells.js";
import { Badge, Button, Card, EmptyState, ErrorCard, Field, InfoCard, Input, Pagination, Select, Tabs, TableWrap, Textarea } from "../ui/kit.js";
import { ConfirmModal } from "../ui/overlay.js";
import { SkeletonList } from "../ui/skeleton.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../ui/mod-meta.js";
import { Icon } from "../ui/icons.js";

const TYPES: { value: "" | PanelSanctionType; label: string }[] = [
  { value: "", label: "Tous les types" }, { value: "warn", label: "Avertissement" }, { value: "timeout", label: "Timeout" }, { value: "kick", label: "Expulsion" }, { value: "ban", label: "Bannissement" },
];
const STATUS = ["", "active", "expired", "revoked", "failed"] as const;
const statusLabel: Record<(typeof STATUS)[number], string> = { "": "Tous les états", active: "Actif", expired: "Expiré", revoked: "Révoqué", failed: "Échoué" };
const typeLabel: Record<PanelSanctionType, string> = { warn: "Avertissement", timeout: "Timeout", kick: "Expulsion", ban: "Bannissement" };

function History() {
  const { guildId } = useParams<{ guildId: string }>();
  const client = useQueryClient();
  const canWrite = useCanWrite();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"" | PanelSanctionType>("");
  const [status, setStatus] = useState<(typeof STATUS)[number]>("");
  const [member, setMember] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModActionDto | null>(null);
  const [toRevoke, setToRevoke] = useState<ModActionDto | null>(null);
  const query = new URLSearchParams({ page: String(page) });
  if (type) query.set("action", type);
  if (status) query.set("status", status);
  if (member) query.set("target", member);
  const history = useQuery({ queryKey: ["sanctions", guildId, page, type, status, member], queryFn: () => api<Paginated<ModActionDto>>(`/api/guilds/${guildId}/mod-actions?${query}`) });
  const revoke = useMutation({
    mutationFn: (id: number) => api(`/api/guilds/${guildId}/sanctions/${id}/revoke`, { method: "POST", body: JSON.stringify({}) }),
    meta: { successMessage: "Sanction révoquée" },
    onSuccess: () => { setToRevoke(null); void client.invalidateQueries({ queryKey: ["sanctions", guildId] }); },
  });
  const totalPages = history.data ? Math.max(1, Math.ceil(history.data.total / history.data.pageSize)) : 1;
  return <div className="space-y-4">
    <Card title="Historique des sanctions" description="Trié par date décroissante. Les filtres et la pagination sont exécutés côté serveur.">
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select value={type} onChange={(event) => { setType(event.target.value as "" | PanelSanctionType); setPage(1); }}><>{TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</></Select>
        <Select value={status} onChange={(event) => { setStatus(event.target.value as (typeof STATUS)[number]); setPage(1); }}><>{STATUS.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}</></Select>
        <div className="xl:col-span-2"><MemberCombobox guildId={guildId!} value={member} onChange={(id) => { setMember(id); setPage(1); }} placeholder="Historique d'un membre…" /></div>
      </div>
      {history.isPending ? <SkeletonList rows={6} /> : history.isError ? <ErrorCard message="Impossible de charger l'historique des sanctions." onRetry={() => void history.refetch()} /> : (history.data?.items.length ?? 0) === 0 ? <EmptyState icon={<Icon.shield />} title="Aucune sanction trouvée" description="Les sanctions appliquées depuis Discord, l'auto-modération ou le panel apparaîtront ici." /> : <>
        <TableWrap><thead><tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Membre</th><th className="py-2 pr-3">Modérateur</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">État</th><th className="py-2 text-right">Date</th></tr></thead><tbody className="divide-y divide-white/5">{history.data!.items.map((item) => <tr key={item.id} className="cursor-pointer hover:bg-(--state-hover)" onClick={() => setDetail(item)}><td className="py-2.5 pr-3"><span className="flex items-center gap-2"><ModActionIcon action={item.action} size={28} /><span className="font-medium text-zinc-100">{actionMeta(item.action).label}</span></span></td><td className="py-2.5 pr-3">{item.targetId ? <UserCell userId={item.targetId} /> : "—"}</td><td className="py-2.5 pr-3"><UserCell userId={item.moderatorId} /></td><td className="py-2.5 pr-3 text-sm text-zinc-400">{item.source === "interaction" ? "Discord" : item.source === "gateway" ? "Auto-mod / Gateway" : "Panel"}</td><td className="py-2.5 pr-3"><Badge tone={item.status === "active" ? "success" : item.status === "revoked" ? "neutral" : item.status === "failed" ? "danger" : "warning"}>{statusLabel[item.status]}</Badge></td><td className="py-2.5 text-right text-zinc-500"><TimeAgo iso={item.createdAt} /></td></tr>)}</tbody></TableWrap>
        <Pagination page={page} totalPages={totalPages} total={history.data?.total} onPage={setPage} />
      </>}
    </Card>
    {detail && <Card title={`Détail de la sanction #${detail.id}`} action={<Button size="sm" variant="secondary" onClick={() => setDetail(null)}>Fermer</Button>}><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500">Raison</dt><dd className="mt-1 text-zinc-200">{detail.reason ?? "Aucune raison"}</dd></div><div><dt className="text-zinc-500">Expiration</dt><dd className="mt-1 text-zinc-200">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleString("fr-FR") : "Non applicable"}</dd></div>{detail.revokedAt && <><div><dt className="text-zinc-500">Révoquée le</dt><dd className="mt-1 text-zinc-200">{new Date(detail.revokedAt).toLocaleString("fr-FR")}</dd></div><div><dt className="text-zinc-500">Par</dt><dd className="mt-1"><UserCell userId={detail.revokedBy ?? "system"} /></dd></div></>}</dl>{canWrite && detail.status === "active" && !["kick", "clear", "unban", "unwarn"].includes(detail.action) && <div className="mt-4 border-t border-zinc-800 pt-4"><Button variant="danger" size="sm" onClick={() => setToRevoke(detail)}>Révoquer cette sanction</Button></div>}</Card>}
    <ConfirmModal open={toRevoke !== null} title="Révoquer cette sanction ?" subject={<>La révocation de <b className="text-zinc-100">{toRevoke && actionMeta(toRevoke.action).label}</b> sera appliquée sur Discord lorsque c'est possible.</>} consequence={toRevoke?.action === "kick" ? "Une expulsion ne peut pas être révoquée." : "L'action est journalisée et l'état de la sanction sera mis à jour."} confirmLabel="Révoquer" loading={revoke.isPending} onCancel={() => setToRevoke(null)} onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)} />
  </div>;
}

function Apply() {
  const { guildId } = useParams<{ guildId: string }>(); const client = useQueryClient(); const canWrite = useCanWrite();
  const [targetId, setTargetId] = useState<string | null>(null); const [type, setType] = useState<PanelSanctionType>("warn"); const [reason, setReason] = useState(""); const [minutes, setMinutes] = useState(60); const [confirm, setConfirm] = useState(false);
  const expiry = type === "timeout" ? new Date(Date.now() + minutes * 60_000).toLocaleString("fr-FR") : null;
  const create = useMutation({ mutationFn: () => api(`/api/guilds/${guildId}/sanctions`, { method: "POST", body: JSON.stringify({ type, targetId, reason, ...(type === "timeout" ? { durationMinutes: minutes } : {}), idempotencyKey: crypto.randomUUID() }) }), meta: { successMessage: "Sanction appliquée" }, onSuccess: () => { setConfirm(false); setReason(""); void client.invalidateQueries({ queryKey: ["sanctions", guildId] }); } });
  const canSubmit = canWrite && !!targetId && reason.trim().length > 0 && (type !== "timeout" || (minutes >= 1 && minutes <= 40_320));
  return <div className="max-w-3xl space-y-4"><Card title="Appliquer une sanction" description="Les protections Discord, la hiérarchie, les exemptions et les permissions sont à nouveau vérifiées par le serveur au moment de l'action."><div className="grid gap-4 sm:grid-cols-2"><Field label="Membre"><MemberCombobox guildId={guildId!} value={targetId} onChange={setTargetId} placeholder="Rechercher le membre à sanctionner…" /></Field><Field label="Type de sanction"><Select value={type} onChange={(event) => setType(event.target.value as PanelSanctionType)}>{TYPES.slice(1).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><div className="sm:col-span-2"><Field label="Raison" hint="Obligatoire, 512 caractères maximum."><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} /></Field></div>{type === "timeout" && <Field label="Durée (minutes)" hint={expiry ? `Expiration : ${expiry}` : undefined}><Input type="number" min={1} max={40320} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></Field>}</div><div className="mt-5 flex justify-end"><Button disabled={!canSubmit} onClick={() => setConfirm(true)}>Continuer</Button></div>{!canWrite && <p className="mt-3 text-sm text-amber-300">Votre niveau d'accès permet la consultation, pas l'application de sanctions.</p>}</Card><InfoCard icon={<Icon.shield />} title="Actions irréversibles">Une expulsion ne peut pas être annulée. Un bannissement retire le membre et empêche son retour tant qu'il n'est pas révoqué.</InfoCard><ConfirmModal open={confirm} title={type === "ban" ? "Bannir ce membre ?" : "Confirmer la sanction ?"} subject={type === "ban" ? <>Vous êtes sur le point de bannir cet utilisateur. Cette action le retirera du serveur et empêchera son retour tant que le ban ne sera pas révoqué.</> : <>La sanction <b className="text-zinc-100">{typeLabel[type]}</b> sera appliquée au membre sélectionné.</>} consequence={expiry ? `Le timeout expirera le ${expiry}.` : type === "kick" ? "Une expulsion n'est pas révocable." : "Cette action est enregistrée dans l'historique de modération."} confirmLabel={type === "ban" ? "Bannir" : "Appliquer la sanction"} loading={create.isPending} onCancel={() => setConfirm(false)} onConfirm={() => create.mutate()} /></div>;
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

export function SanctionsPage() { const [tab, setTab] = useState("history"); return <div className="space-y-5"><Tabs active={tab} onChange={setTab} tabs={[{ id: "history", label: "Historique" }, { id: "apply", label: "Appliquer une sanction" }, { id: "settings", label: "Paramètres et exemptions" }]} />{tab === "history" ? <History /> : tab === "apply" ? <Apply /> : <Settings />}</div>; }
