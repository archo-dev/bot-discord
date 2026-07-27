import type { ComponentStatus, PublicStatus, StudioOverview } from "@bot/shared";
import { fmtTimeFr, relativeTimeFr } from "../../lib/format.js";

type Tone = "success" | "warning" | "danger" | "neutral";

const STATUS_VIEW: Record<ComponentStatus, { label: string; tone: Tone }> = {
  up: { label: "Opérationnel", tone: "success" },
  degraded: { label: "Dégradé", tone: "warning" },
  down: { label: "Indisponible", tone: "danger" },
};

const DOT_TONE: Record<Tone, string> = {
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-zinc-600",
};

/** One health indicator: colored dot + label + value. Never shows a positive
 * state when the datum is missing — falls back to « Inconnu » (neutral). */
export function HealthItem({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="truncate text-sm text-zinc-200">{value}</div>
      </div>
    </div>
  );
}

function view(status: ComponentStatus | undefined): { label: string; tone: Tone } {
  if (!status) return { label: "Inconnu", tone: "neutral" };
  return STATUS_VIEW[status];
}

/**
 * Component-health strip, fed only by the existing public /status route. When
 * the whole call failed (`status === null`), every component reads « Inconnu ».
 */
export function HealthStrip({
  status,
  latestUpdate,
}: {
  status: PublicStatus | null;
  latestUpdate: StudioOverview["latestUpdate"];
}) {
  const byName = (name: string) => status?.components.find((c) => c.name === name);
  const gateway = byName("gateway");
  const gatewayView = view(gateway?.status);
  const gatewayDetail =
    gatewayView.label +
    (typeof gateway?.heartbeatAgeSeconds === "number"
      ? ` · heartbeat ${gateway.heartbeatAgeSeconds} s`
      : "");
  const overall = view(status?.status);

  return (
    <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-4">
      <HealthItem label="État global" value={overall.label} tone={overall.tone} />
      <HealthItem label="Gateway" value={gatewayDetail} tone={gatewayView.tone} />
      <HealthItem label="Worker" value={view(byName("worker")?.status).label} tone={view(byName("worker")?.status).tone} />
      <HealthItem label="D1" value={view(byName("d1")?.status).label} tone={view(byName("d1")?.status).tone} />
      <HealthItem label="KV" value={view(byName("kv")?.status).label} tone={view(byName("kv")?.status).tone} />
      <HealthItem
        label="Vérifié"
        value={status ? fmtTimeFr(status.observedAt) : "Non disponible"}
        tone="neutral"
      />
      <HealthItem
        label="Dernière publication"
        value={latestUpdate ? `${latestUpdate.title} · ${relativeTimeFr(latestUpdate.publishedAt)}` : "Aucune"}
        tone="neutral"
      />
    </div>
  );
}
