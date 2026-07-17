import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import type { GuildPrivacyResponse, ProductFeedbackCategory, ProductFeedbackResponse } from "@bot/shared";
import { api } from "../lib/api.js";
import { useCanWrite } from "../lib/access.js";
import { Badge, Button, Card, ErrorCard, Field, InfoCard, Select, Textarea, Toggle } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";

export function PrivacyPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ProductFeedbackCategory>("idea");
  const [message, setMessage] = useState("");

  const privacy = useQuery({
    queryKey: ["privacy", guildId],
    queryFn: () => api<GuildPrivacyResponse>(`/api/guilds/${guildId}/privacy`),
  });
  const update = useMutation({
    mutationFn: (enabled: boolean) => api<GuildPrivacyResponse>(`/api/guilds/${guildId}/privacy`, {
      method: "PATCH", body: JSON.stringify({ productAnalyticsEnabled: enabled }),
    }),
    meta: { successMessage: "Préférence de confidentialité enregistrée." },
    onSuccess: (data) => queryClient.setQueryData(["privacy", guildId], data),
  });
  const feedback = useMutation({
    mutationFn: () => api<ProductFeedbackResponse>(`/api/guilds/${guildId}/feedback`, {
      method: "POST", body: JSON.stringify({ category, message }),
    }),
    meta: { successMessage: "Merci, votre retour a été envoyé." },
    onSuccess: () => setMessage(""),
  });

  if (privacy.isPending) return <SkeletonSettingsPage cards={2} />;
  if (privacy.isError) return <ErrorCard onRetry={() => void privacy.refetch()} />;

  return (
    <div className="space-y-5">
      <Card
        title="Analytics produit minimales"
        description="Aidez-nous à comprendre l’installation, la prise en main et l’adoption des modules. Aucun contenu Discord ni membre n’est suivi."
      >
        {canWrite ? (
          <Toggle
            checked={privacy.data.productAnalyticsEnabled}
            onChange={(enabled) => update.mutate(enabled)}
            label="Participer aux analytics produit"
            description="Désactiver purge immédiatement les contributions pseudonymisées encore rattachables à cette guilde."
          />
        ) : (
          <div className="flex items-center justify-between gap-4 text-sm text-zinc-300">
            État de la collecte
            <Badge tone={privacy.data.productAnalyticsEnabled ? "success" : "neutral"}>
              {privacy.data.productAnalyticsEnabled ? "Activée" : "Désactivée"}
            </Badge>
          </div>
        )}
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-950 p-3"><dt className="text-zinc-500">Contributions</dt><dd className="mt-1 text-zinc-200">{privacy.data.contributionRetentionDays} jours</dd></div>
          <div className="rounded-lg bg-zinc-950 p-3"><dt className="text-zinc-500">Agrégats</dt><dd className="mt-1 text-zinc-200">{privacy.data.aggregateRetentionDays} jours</dd></div>
          <div className="rounded-lg bg-zinc-950 p-3"><dt className="text-zinc-500">Feedback</dt><dd className="mt-1 text-zinc-200">{privacy.data.feedbackRetentionDays} jours</dd></div>
        </dl>
      </Card>

      <Card title="Envoyer un retour" description="Ce formulaire est volontaire et stocké séparément des analytics.">
        <div className="space-y-4">
          <Field label="Sujet">
            <Select value={category} onChange={(event) => setCategory(event.target.value as ProductFeedbackCategory)} disabled={!canWrite}>
              <option value="idea">Idée</option><option value="problem">Problème</option><option value="onboarding">Prise en main</option>
              <option value="module">Module</option><option value="uninstall">Désinstallation</option><option value="other">Autre</option>
            </Select>
          </Field>
          <Field label="Message" hint={`${message.length}/1000 — n’incluez aucun token, identifiant ou contenu privé.`}>
            <Textarea value={message} maxLength={1000} disabled={!canWrite} onChange={(event) => setMessage(event.target.value)} placeholder="Votre retour…" />
          </Field>
          {canWrite && <Button loading={feedback.isPending} disabled={message.trim().length === 0} onClick={() => feedback.mutate()}>Envoyer</Button>}
        </div>
      </Card>

      <InfoCard icon={<Icon.shield />} title="Données exclues">
        Aucun identifiant utilisateur, pseudo, message, salon, rôle, adresse IP, propriété libre, cookie marketing ou tracker tiers. Les données techniques SLO restent séparées.
      </InfoCard>
    </div>
  );
}
