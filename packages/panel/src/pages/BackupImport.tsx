import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BACKUP_MODULE_LABELS,
  type BackupModuleId,
  type ChannelOption,
  type ConfigExport,
  type ImportApplyResult,
  type ImportReference,
  type ImportValidateResult,
  type RoleOption,
} from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Button, Select } from "../ui/kit.js";
import { Modal } from "../ui/overlay.js";
import { toast } from "../ui/toast.js";
import { invalidateConfigQueries } from "./Backup.js";

const DROP = "__drop__";

export function BackupImport({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [exported, setExported] = useState<ConfigExport | null>(null);
  const [validation, setValidation] = useState<ImportValidateResult | null>(null);
  const [modules, setModules] = useState<BackupModuleId[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const channels = useQuery({ queryKey: ["channels", guildId], queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`) });
  const roles = useQuery({ queryKey: ["roles", guildId], queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`) });

  const validate = useMutation({
    mutationFn: (parsed: ConfigExport) => api<ImportValidateResult>(`/api/guilds/${guildId}/config-import/validate`, { method: "POST", body: JSON.stringify({ export: parsed }) }),
    onSuccess: (result, parsed) => {
      setValidation(result);
      setModules(result.modules);
      // Same-guild import defaults each reference to itself; cross-guild starts unset.
      setMapping(Object.fromEntries(result.references.map((ref) => [ref.sourceId, result.sameGuild ? ref.sourceId : ""])));
      if (!result.ok) toast.error(result.issues[0] ?? "Fichier invalide.");
      setExported(parsed);
    },
    onError: () => toast.error("Validation impossible."),
  });

  const apply = useMutation({
    mutationFn: () => api<ImportApplyResult>(`/api/guilds/${guildId}/config-import/apply`, {
      method: "POST",
      body: JSON.stringify({
        export: exported,
        modules,
        mapping: Object.fromEntries(Object.entries(mapping).map(([id, value]) => [id, value === DROP ? null : value])),
      }),
    }),
    onSuccess: () => { toast.success("Configuration importée."); invalidateConfigQueries(queryClient, guildId); onClose(); },
    onError: () => toast.error("Import impossible."),
  });

  async function onFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as ConfigExport;
      validate.mutate(parsed);
    } catch {
      toast.error("Fichier JSON illisible.");
    }
  }

  const refsToMap = (validation?.references ?? []).filter((ref) => modules.includes(ref.usedBy[0]!) || ref.usedBy.some((m) => modules.includes(m)));
  const allMapped = refsToMap.every((ref) => mapping[ref.sourceId]);
  const canApply = validation?.ok === true && modules.length > 0 && allMapped;

  function optionsFor(ref: ImportReference) {
    return ref.type === "channel"
      ? (channels.data ?? []).filter((ch) => ch.type !== 4).map((ch) => ({ id: ch.id, label: `#${ch.name}` }))
      : (roles.data ?? []).map((role) => ({ id: role.id, label: role.name }));
  }

  return (
    <Modal open onClose={onClose} title="Importer une configuration" size="2xl" locked={apply.isPending}>
      {!validation ? (
        <div>
          <p className="text-sm text-zinc-400">Choisissez un fichier d'export (.json). Il sera vérifié avant toute application.</p>
          <label className="mt-4 flex h-28 cursor-pointer items-center justify-center rounded-xl border border-dashed border-zinc-700 text-sm text-zinc-400 transition hover:border-indigo-500/70">
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            {validate.isPending ? "Vérification…" : "Cliquez pour choisir un fichier"}
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          {validation.issues.length > 0 && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              {validation.issues.map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          )}
          {!validation.sameGuild && validation.ok && (
            <p className="text-[13px] text-zinc-400">Import depuis un autre serveur : associez chaque salon/rôle à une entité de ce serveur.</p>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Modules à importer</h3>
            <div className="flex flex-wrap gap-2">
              {validation.modules.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={modules.includes(m)} className="accent-indigo-500"
                    onChange={() => setModules((cur) => cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m])} />
                  {BACKUP_MODULE_LABELS[m]}
                </label>
              ))}
            </div>
          </div>

          {refsToMap.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">Correspondance des salons et rôles</h3>
              <div className="space-y-2">
                {refsToMap.map((ref) => (
                  <div key={ref.sourceId} className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{ref.type === "channel" ? "Salon" : "Rôle"}</Badge>
                    <span className="font-mono text-xs text-zinc-500">{ref.sourceId}</span>
                    <span aria-hidden className="text-zinc-600">→</span>
                    <Select
                      aria-label={`Correspondance pour ${ref.sourceId}`}
                      value={mapping[ref.sourceId] ?? ""}
                      onChange={(e) => setMapping((cur) => ({ ...cur, [ref.sourceId]: e.target.value }))}
                      className="max-w-56"
                    >
                      <option value="">— choisir —</option>
                      <option value={DROP}>— ignorer (retirer) —</option>
                      {optionsFor(ref).map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>Annuler</Button>
            <Button disabled={!canApply} loading={apply.isPending} onClick={() => apply.mutate()}>Appliquer l'import</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
