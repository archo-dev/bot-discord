import type { GuildModuleDto } from "@bot/shared";
import { MODULE_STATE_META, moduleReasonLabel } from "../../lib/modules.js";
import { Badge, Card } from "../../ui/kit.js";

function ContextLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "text-zinc-300",
    success: "text-emerald-300",
    warning: "text-amber-300",
    danger: "text-red-300",
  }[tone];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`max-w-[62%] break-words text-right text-xs font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

export function ModuleStatusPanel({
  module,
  moduleLoading,
  moduleError,
  gatewayConnected,
  canWrite,
  configurationAllowed,
  enabled,
  targetChannel,
  dirtyState,
}: {
  module: GuildModuleDto | undefined;
  moduleLoading: boolean;
  moduleError: boolean;
  gatewayConnected: boolean;
  canWrite: boolean;
  configurationAllowed: boolean;
  enabled: boolean;
  targetChannel: string;
  dirtyState: { label: string; tone: "success" | "warning" | "danger" };
}) {
  const meta = module ? MODULE_STATE_META[module.state] : null;
  const reasons = module?.enabled ? module.reasons : module?.activationReasons;
  const diagnostic = module
    ? moduleReasonLabel(reasons?.[0] ?? { code: module.enabled ? "module_enabled" : "module_disabled" })
    : "Informations du module non disponibles.";
  return (
    <Card title="État du module" description="Contexte issu des contrats existants." pad="compact">
      <div className="mb-1 flex justify-end">
        {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
      </div>
      <dl>
        <ContextLine label="Module" value={meta?.label ?? (moduleLoading ? "Chargement…" : "Non disponible")} tone={module?.state === "enabled" ? "success" : module ? "warning" : "neutral"} />
        <ContextLine label="Configuration" value={enabled ? "Activée dans le brouillon" : "Désactivée dans le brouillon"} tone={enabled ? "success" : "warning"} />
        <ContextLine label="Gateway" value={gatewayConnected ? "Connectée" : "Indisponible"} tone={gatewayConnected ? "success" : "danger"} />
        <ContextLine label="Votre accès" value={canWrite ? "Administration" : "Lecture seule"} tone={canWrite ? "success" : "warning"} />
        <ContextLine label="Capacité" value={!canWrite ? "Lecture seule" : configurationAllowed ? "Configuration autorisée" : "Permission insuffisante"} tone={!canWrite || !configurationAllowed ? "danger" : "success"} />
        <ContextLine label="Salon cible" value={targetChannel || "Non sélectionné"} />
        <ContextLine label="Brouillon" value={dirtyState.label} tone={dirtyState.tone} />
      </dl>
      <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
        {moduleError ? "État du module non disponible." : diagnostic}
      </p>
    </Card>
  );
}
