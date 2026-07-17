import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  OnboardingPresetId,
  OnboardingPresetPreview,
  OnboardingPresetResult,
  OnboardingResponse,
} from "@bot/shared";
import { api } from "../lib/api.js";
import { moduleReasonLabel } from "../lib/modules.js";
import { Badge, Button, Card } from "../ui/kit.js";
import { Modal } from "../ui/overlay.js";
import { toast } from "../ui/toast.js";

const ACTION_META = {
  enable: { label: "Sera activé", tone: "success" as const },
  already_enabled: { label: "Déjà actif", tone: "neutral" as const },
  blocked: { label: "Bloqué", tone: "warning" as const },
};

export function PresetPicker({ guildId, response, canWrite }: {
  guildId: string;
  response: OnboardingResponse;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<OnboardingPresetPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: (preset: OnboardingPresetId) => api<OnboardingPresetPreview>(`/api/guilds/${guildId}/onboarding/preset`, {
      method: "POST",
      body: JSON.stringify({ preset, dryRun: true }),
    }),
    onSuccess: setPreview,
    onError: () => toast.error("Aperçu du preset impossible."),
  });

  const applyMutation = useMutation({
    mutationFn: (preset: OnboardingPresetId) => api<OnboardingPresetResult>(`/api/guilds/${guildId}/onboarding/preset`, {
      method: "POST",
      body: JSON.stringify({ preset }),
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding", guildId] });
      void queryClient.invalidateQueries({ queryKey: ["modules", guildId] });
      setPreview(null);
      toast.success(result.enabled.length > 0 ? `${result.enabled.length} module(s) activé(s).` : "Preset appliqué.");
    },
    onError: () => toast.error("Application du preset impossible."),
  });

  return (
    <Card>
      <h2 className="font-semibold text-zinc-100">Presets de démarrage</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Activez d'un coup un ensemble de modules cohérent. Aucun réglage existant n'est écrasé — vous configurez ensuite
        chaque module.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {response.presets.map((preset) => (
          <div key={preset.id} className="flex flex-col rounded-xl border border-zinc-800/90 bg-(--surface-2) p-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-zinc-100">{preset.name}</h3>
              {response.appliedPreset === preset.id && <Badge tone="primary">Appliqué</Badge>}
            </div>
            <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-zinc-400">{preset.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {preset.modules.map((id) => <Badge key={id} tone="neutral">{id}</Badge>)}
            </div>
            <Button
              className="mt-4"
              size="sm"
              disabled={!canWrite}
              loading={previewMutation.isPending && previewMutation.variables === preset.id}
              onClick={() => previewMutation.mutate(preset.id)}
            >
              Prévisualiser
            </Button>
          </div>
        ))}
      </div>

      <Modal open={preview !== null} onClose={() => setPreview(null)} title="Aperçu du preset" locked={applyMutation.isPending}>
        {preview && (
          <>
            <p className="text-sm text-zinc-400">Voici ce qui changera. Rien d'autre ne sera modifié.</p>
            <ul className="mt-3 divide-y divide-zinc-800/70">
              {preview.entries.map((entry) => (
                <li key={entry.moduleId} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-100">{entry.publicName}</span>
                    {entry.action === "blocked" && entry.reason && (
                      <p className="mt-0.5 text-xs text-amber-300">{moduleReasonLabel(entry.reason)}</p>
                    )}
                  </div>
                  <Badge tone={ACTION_META[entry.action].tone}>{ACTION_META[entry.action].label}</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={applyMutation.isPending}>Annuler</Button>
              <Button
                loading={applyMutation.isPending}
                disabled={!preview.applicable}
                onClick={() => applyMutation.mutate(preview.preset)}
              >
                {preview.applicable ? "Appliquer" : "Rien à activer"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}
