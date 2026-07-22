import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AccountResponse } from "@bot/shared";
import { api, avatarUrl } from "../../lib/api.js";
import { Button, Card, ErrorCard, PageHeader } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";
import { formatDateTime } from "../../lib/subscription.js";

/*
 * Espace compte client (M8) — profil + session courante + déconnexion globale.
 * Lecture seule (sauf « se déconnecter partout » qui réutilise l'endpoint audité
 * /auth/revoke-all). Route lazy, gardée par platform.entitlements.
 */
export function AccountPage() {
  useEffect(() => {
    document.title = "Mon compte — Panel du bot";
  }, []);

  const account = useQuery({ queryKey: ["account"], queryFn: () => api<AccountResponse>("/api/account"), retry: false });
  const revokeAll = useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/revoke-all", { method: "POST" }),
    meta: { errorMessage: "La déconnexion globale a échoué — réessayez." },
    onSuccess: () => location.reload(),
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader eyebrow="Espace client" title="Mon compte" description="Votre profil et votre session." />

      {account.isPending ? (
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      ) : account.isError ? (
        <ErrorCard message="Impossible de charger votre compte." onRetry={() => void account.refetch()} />
      ) : (
        <>
          <Card className="mt-6">
            <div className="flex items-center gap-4">
              <img src={avatarUrl(account.data.id, account.data.avatar, 96)} alt="" className="h-14 w-14 rounded-full ring-2 ring-zinc-800" />
              <div>
                <p className="text-base font-semibold text-zinc-100">{account.data.globalName ?? account.data.username}</p>
                <p className="text-sm text-zinc-500">@{account.data.username}</p>
              </div>
            </div>
          </Card>

          <Card className="mt-4">
            <h2 className="text-sm font-semibold text-zinc-200">Session actuelle</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-zinc-500">Connecté depuis</dt>
                <dd className="text-zinc-200">{formatDateTime(account.data.session.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Dernière activité</dt>
                <dd className="text-zinc-200">{formatDateTime(account.data.session.lastSeenAt)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Expire le</dt>
                <dd className="text-zinc-200">{formatDateTime(account.data.session.expiresAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">Sécurité</h2>
                <p className="mt-1 text-sm text-zinc-500">Déconnecte toutes vos sessions actives sur tous vos appareils.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => revokeAll.mutate()} loading={revokeAll.isPending}>
                {revokeAll.isPending ? "Déconnexion…" : "Se déconnecter partout"}
              </Button>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
