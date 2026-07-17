import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnboardingResponse, OnboardingStep, OnboardingStepStatus } from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { DisclosureCard } from "../ui/disclosure.js";
import { Badge, Button, Card, ErrorCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { Skeleton } from "../ui/skeleton.js";
import { toast } from "../ui/toast.js";
import { PresetPicker } from "./OnboardingPresets.js";

const STATUS_META: Record<OnboardingStepStatus, { label: string; tone: "success" | "warning" | "neutral" }> = {
  done: { label: "Terminé", tone: "success" },
  attention: { label: "À vérifier", tone: "warning" },
  todo: { label: "À faire", tone: "neutral" },
  skipped: { label: "Ignoré", tone: "neutral" },
};

function StepIcon({ status }: { status: OnboardingStepStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/15 text-green-400" aria-hidden>
        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M8.1 13.3 4.8 10l-1.1 1.1 4.4 4.4 9-9-1.1-1.1z" /></svg>
      </span>
    );
  }
  if (status === "attention") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-400" aria-hidden>
        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M10 2 1 18h18L10 2zm1 12H9v-2h2v2zm0-3H9V7h2v4z" /></svg>
      </span>
    );
  }
  return <span className={`h-7 w-7 rounded-full border-2 ${status === "skipped" ? "border-zinc-700" : "border-zinc-600"}`} aria-hidden />;
}

function StepRow({ step, guildId, canWrite, onDismiss }: {
  step: OnboardingStep;
  guildId: string;
  canWrite: boolean;
  onDismiss: (id: string) => void;
}) {
  const meta = STATUS_META[step.status];
  return (
    <li className="flex items-start gap-3 py-3">
      <StepIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${step.status === "skipped" ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{step.title}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{step.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {step.href && step.status !== "done" && (
          <Link
            to={`/guilds/${guildId}/${step.href}`}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-(--surface-2) px-3 text-[13px] font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            {step.status === "attention" ? "Corriger" : "Configurer"}
          </Link>
        )}
        {canWrite && step.dismissible && step.status !== "done" && step.status !== "skipped" && (
          <Button size="sm" variant="ghost" onClick={() => onDismiss(step.id)}>Ignorer</Button>
        )}
      </div>
    </li>
  );
}

export function OnboardingPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const queryKey = ["onboarding", guildId];

  const onboarding = useQuery({
    queryKey,
    queryFn: () => api<OnboardingResponse>(`/api/guilds/${guildId}/onboarding`),
  });

  useEffect(() => {
    document.title = "Prise en main — Panel du bot";
  }, []);

  const dismiss = useMutation({
    mutationFn: (step: string) => api<OnboardingResponse>(`/api/guilds/${guildId}/onboarding/dismiss`, {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onError: () => toast.error("Action impossible pour le moment."),
  });

  if (onboarding.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }
  if (onboarding.isError) return <ErrorCard message="Impossible de charger la prise en main." onRetry={() => void onboarding.refetch()} />;

  const data = onboarding.data;
  const pct = data.progress.total === 0 ? 100 : Math.round((data.progress.done / data.progress.total) * 100);

  return (
    <div className="space-y-4">
      {/* Progression */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-zinc-100">
              {data.completedAt ? "Configuration terminée 🎉" : "Terminez votre configuration"}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">{data.progress.done} étape(s) sur {data.progress.total} complétée(s).</p>
          </div>
          {canWrite && !data.completedAt && (
            <Button variant="ghost" size="sm" loading={dismiss.isPending && dismiss.variables === "__complete__"} onClick={() => dismiss.mutate("__complete__")}>
              Marquer comme terminé
            </Button>
          )}
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      {/* Presets (aperçu + application) */}
      <PresetPicker guildId={guildId!} response={data} canWrite={canWrite} />

      {/* Checklist */}
      <Card>
        <h2 className="font-semibold text-zinc-100">Liste de vérification</h2>
        <ul className="mt-1 divide-y divide-zinc-800/70">
          {data.steps.map((step) => (
            <StepRow key={step.id} step={step} guildId={guildId!} canWrite={canWrite} onDismiss={(id) => dismiss.mutate(id)} />
          ))}
        </ul>
      </Card>

      {/* Invitation / permissions */}
      <DisclosureCard title="Permissions du bot" description="Ré-invitation et permissions requises par les modules.">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden><Icon.key /></span>
          <div className="min-w-0 flex-1">
            <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
              Si un module signale une permission manquante, ré-invitez le bot pour accorder l'accès. Chaque permission
              correspond aux modules qui en ont besoin — le bot ne demande jamais l'accès administrateur global.
            </p>
            <a
              href={data.invite.url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-700 bg-(--surface-2) px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Ré-inviter avec les permissions requises
            </a>
          </div>
        </div>
      </DisclosureCard>
    </div>
  );
}
