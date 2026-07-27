import { useState } from "react";
import type { GrantablePlan } from "@bot/shared";
import { StudioApiError, goToStepUp, studioApi } from "../../api.js";
import { errorInfoFr } from "../../lib/errors.js";
import { fullDateFr } from "../../lib/format.js";
import { AsyncButton, InlineNotice, SensitiveActionDialog, useToast } from "../../ui/index.js";

/**
 * Guided grant wizard (Lot 6). Pure presentation refactor of the former raw
 * form: it produces byte-for-byte the same payloads and calls the same
 * endpoints. Standard durations → studioApi.grant(...); lifetime keeps the exact
 * critical flow (typed LIFETIME + step-up) via SensitiveActionDialog.
 */

const STANDARD_DURATIONS = ["7d", "30d", "3m", "6m", "1y"] as const;
type StandardDuration = (typeof STANDARD_DURATIONS)[number];
type Duration = StandardDuration | "lifetime";

const DURATION_LABEL: Record<Duration, string> = {
  "7d": "7 jours",
  "30d": "30 jours",
  "3m": "3 mois",
  "6m": "6 mois",
  "1y": "1 an",
  lifetime: "À vie (lifetime)",
};

const STEPS = ["Cible", "Plan", "Durée", "Options", "Vérification"] as const;

// Display-only mirrors of stable @bot/shared product data (PLANS.slots / displayName)
// and resolveGrantWindow's date math. Imported as VALUES they would pull the whole
// shared barrel (zod, …) into the bundle. The grant payload only carries
// `durationKind`; the backend remains the sole authority on the actual window.
const PLAN_INFO: Record<GrantablePlan, { name: string; slots: number }> = {
  premium: { name: "Premium", slots: 3 },
  business: { name: "Business", slots: 5 },
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const addMonths = (d: Date, n: number) => {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
};
function previewEndAt(kind: StandardDuration, startISO: string): string {
  const s = new Date(startISO);
  switch (kind) {
    case "7d": return addDays(s, 7).toISOString();
    case "30d": return addDays(s, 30).toISOString();
    case "3m": return addMonths(s, 3).toISOString();
    case "6m": return addMonths(s, 6).toISOString();
    case "1y": return addMonths(s, 12).toISOString();
  }
}

export function GrantWizard({ canGrant, canLifetime, onGranted }: { canGrant: boolean; canLifetime: boolean; onGranted: () => void }) {
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState<GrantablePlan>("premium");
  const [duration, setDuration] = useState<Duration>(canGrant ? "30d" : "lifetime");
  const [earlyAccess, setEarlyAccess] = useState(false);
  const [reason, setReason] = useState("");
  const [lifetimeOpen, setLifetimeOpen] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [startAt] = useState(() => new Date().toISOString());
  const toast = useToast();

  const idValid = /^\d{17,20}$/.test(userId.trim());
  const reasonValid = reason.trim().length >= 3;
  const stepValid = (s: number) => (s === 1 ? idValid : s === 4 ? reasonValid : true);

  const isLifetime = duration === "lifetime";
  const endAt = isLifetime ? null : previewEndAt(duration, startAt);

  const reset = () => {
    setStep(1);
    setUserId("");
    setReason("");
    setEarlyAccess(false);
    setPlanId("premium");
    setDuration(canGrant ? "30d" : "lifetime");
    setLifetimeOpen(false);
    setStepUp(false);
  };

  const notify = (e: unknown) => {
    const info = errorInfoFr(e instanceof StudioApiError ? e.code : "error");
    toast.error(info.title, info.description);
  };

  // Standard grant — identical payload to the former form.
  const submitStandard = async () => {
    try {
      await studioApi.grant({ userId, planId, durationKind: duration as StandardDuration, reason, origin: earlyAccess ? "early_access" : "standard" });
      toast.success("Accès offert octroyé", `Plan ${planId} accordé à ${userId}.`);
      reset();
      onGranted();
    } catch (e) {
      notify(e);
    }
  };

  // Lifetime — identical payload + identical critical flow (LIFETIME + step-up).
  const submitLifetime = async () => {
    try {
      await studioApi.grantLifetime({ userId, planId, reason, confirm: "LIFETIME" });
      toast.success("Accès à vie octroyé", `Lifetime ${planId} accordé à ${userId}.`);
      setLifetimeOpen(false);
      reset();
      onGranted();
    } catch (e) {
      if (e instanceof StudioApiError && e.code === "step_up_required") {
        setStepUp(true);
        toast.warning("Ré-authentification requise", "Confirmez votre identité Discord avant l'octroi à vie.");
        return;
      }
      notify(e);
    }
  };

  const summary = (
    <dl className="space-y-2 text-sm">
      <SummaryRow label="Cible" value={userId || "—"} mono />
      <SummaryRow label="Plan" value={PLAN_INFO[planId].name} />
      <SummaryRow label="Durée" value={DURATION_LABEL[duration]} danger={isLifetime} />
      <SummaryRow label="Début" value={fullDateFr(startAt)} />
      <SummaryRow label="Fin" value={isLifetime ? "Aucune fin (à vie)" : fullDateFr(endAt)} danger={isLifetime} />
      {!isLifetime && <SummaryRow label="Source" value={earlyAccess ? "Accès bêta (early access)" : "Accès offert (standard)"} />}
      <SummaryRow label="Raison" value={reason || "—"} />
    </dl>
  );

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="lg:grid lg:grid-cols-[1fr_18rem] lg:gap-6">
        {/* Left: stepper + step content */}
        <div>
          {/* Stepper */}
          <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Progression">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const current = n === step;
              return (
                <li key={label} aria-current={current ? "step" : undefined} className="flex items-center gap-2">
                  <span className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${current ? "bg-indigo-600 text-white" : done ? "bg-green-900 text-green-200" : "bg-zinc-800 text-zinc-500"}`}>
                    {done ? "✓" : n}
                  </span>
                  <span className={current ? "font-semibold text-zinc-100" : "text-zinc-500"}>{label}</span>
                  {n < STEPS.length && <span className="text-zinc-700">›</span>}
                </li>
              );
            })}
          </ol>

          {/* Step content */}
          {step === 1 && (
            <StepBlock title="Cible" hint="Identifiant Discord (snowflake) du membre qui recevra l'accès.">
              <label className="block text-sm text-zinc-300">
                User ID
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="123456789012345678"
                  aria-invalid={userId !== "" && !idValid}
                  className="mt-1.5 w-full max-w-sm rounded bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              {userId !== "" && !idValid && <p className="mt-1.5 text-xs text-red-400">Identifiant invalide — 17 à 20 chiffres attendus.</p>}
            </StepBlock>
          )}

          {step === 2 && (
            <StepBlock title="Plan" hint="Plans réellement octroyables (un octroi élève toujours l'accès).">
              <div className="flex flex-wrap gap-3">
                {(["premium", "business"] as const).map((p) => {
                  const selected = planId === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPlanId(p)}
                      className={`w-44 rounded-lg border p-3 text-left transition-colors ${selected ? "border-indigo-500 bg-indigo-600/10" : "border-zinc-700 hover:bg-zinc-800/60"}`}
                    >
                      <div className="text-sm font-semibold text-zinc-100">{PLAN_INFO[p].name}</div>
                      <div className="mt-1 text-xs text-zinc-400">{PLAN_INFO[p].slots} serveur{PLAN_INFO[p].slots > 1 ? "s" : ""} affectable{PLAN_INFO[p].slots > 1 ? "s" : ""}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-600">Autres capacités : en cours de définition</div>
                    </button>
                  );
                })}
              </div>
            </StepBlock>
          )}

          {step === 3 && (
            <StepBlock title="Durée" hint="L'accès démarre immédiatement et expire automatiquement à l'échéance.">
              <div className="flex flex-wrap gap-2">
                {canGrant && STANDARD_DURATIONS.map((d) => (
                  <DurationChip key={d} label={DURATION_LABEL[d]} selected={duration === d} onClick={() => setDuration(d)} />
                ))}
                {canLifetime && <DurationChip label={DURATION_LABEL.lifetime} selected={duration === "lifetime"} danger onClick={() => setDuration("lifetime")} />}
              </div>
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                <SummaryRow label="Début" value={fullDateFr(startAt)} />
                <SummaryRow label="Fin" value={isLifetime ? "Aucune fin (à vie)" : fullDateFr(endAt)} danger={isLifetime} />
              </div>
            </StepBlock>
          )}

          {step === 4 && (
            <StepBlock title="Options" hint="Motif obligatoire — il est journalisé avec l'octroi.">
              {!isLifetime && (
                <label className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
                  <input type="checkbox" checked={earlyAccess} onChange={(e) => setEarlyAccess(e.target.checked)} />
                  Accès bêta (early access)
                </label>
              )}
              <label className="block text-sm text-zinc-300">
                Raison
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motif de l'octroi (obligatoire)"
                  aria-invalid={reason !== "" && !reasonValid}
                  className="mt-1.5 w-full max-w-md rounded bg-zinc-800 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              {reason !== "" && !reasonValid && <p className="mt-1.5 text-xs text-red-400">La raison doit contenir au moins 3 caractères.</p>}
            </StepBlock>
          )}

          {step === 5 && (
            <StepBlock title="Vérification" hint="Vérifiez les informations avant d'octroyer l'accès.">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 lg:hidden">{summary}</div>
              {isLifetime && (
                <div className="mt-3">
                  <InlineNotice tone="warning">Octroi à vie — engagement permanent et irréversible. Confirmation critique et ré-authentification requises.</InlineNotice>
                </div>
              )}
            </StepBlock>
          )}

          {/* Nav */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              ← Retour
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid(step)}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Continuer →
              </button>
            ) : isLifetime ? (
              <button
                type="button"
                onClick={() => {
                  setStepUp(false);
                  setLifetimeOpen(true);
                }}
                className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
              >
                Octroyer à vie…
              </button>
            ) : (
              <AsyncButton onClick={submitStandard} busyLabel="Octroi…">
                Octroyer
              </AsyncButton>
            )}
          </div>
        </div>

        {/* Right: sticky summary (desktop) */}
        <aside className="mt-6 hidden lg:mt-0 lg:block">
          <div className="sticky top-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Récapitulatif</h3>
            {summary}
          </div>
        </aside>
      </div>

      <SensitiveActionDialog
        open={lifetimeOpen}
        onClose={() => setLifetimeOpen(false)}
        title="Octroyer un accès à vie"
        description="Engagement permanent et irréversible sur le compte cible."
        confirmWord="LIFETIME"
        confirmLabel="Ré-authentifier & octroyer"
        onConfirm={submitLifetime}
        stepUpRequired={stepUp}
        onStepUp={goToStepUp}
        impact={
          <div className="space-y-1">
            <div><span className="text-red-300/70">Utilisateur : </span>{userId || "—"}</div>
            <div><span className="text-red-300/70">Plan : </span>{PLAN_INFO[planId].name}</div>
            <div><span className="text-red-300/70">Durée : </span>À vie (lifetime)</div>
            <div><span className="text-red-300/70">Raison : </span>{reason || "—"}</div>
          </div>
        }
      />
    </section>
  );
}

function StepBlock({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-zinc-500">{hint}</p>
      {children}
    </div>
  );
}

function DurationChip({ label, selected, danger, onClick }: { label: string; selected: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
        selected
          ? danger
            ? "border-red-500 bg-red-600/15 text-red-200"
            : "border-indigo-500 bg-indigo-600/15 text-zinc-100"
          : "border-zinc-700 text-zinc-300 hover:bg-zinc-800/60"
      }`}
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${danger ? "text-red-300" : "text-zinc-200"} ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</dd>
    </div>
  );
}
