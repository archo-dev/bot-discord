import { Suspense } from "react";
import { NavLink, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@bot/shared";
import { api, avatarUrl } from "../lib/api.js";
import { getPlatformFlags } from "../lib/flags.js";
import { Wordmark } from "../ui/brand.js";
import { Icon } from "../ui/icons.js";
import { Skeleton } from "../ui/skeleton.js";

/*
 * Shell de l'espace client (M8) — nav Serveurs / Abonnement / Compte (+ Facturation
 * en M9). Monté uniquement quand `platform.entitlements` est ON (routes /app/*
 * gardées par le flag dans App.tsx). Chargé à la demande (chunk séparé).
 */
const BASE_LINKS = [
  { to: "/", label: "Serveurs", end: true, icon: <Icon.home /> },
  { to: "/app/subscription", label: "Abonnement", end: false, icon: <Icon.star /> },
  { to: "/app/account", label: "Compte", end: false, icon: <Icon.users /> },
];

export function AppLayout() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeResponse>("/api/me"), retry: false });
  const flags = getPlatformFlags();
  const LINKS = [
    ...BASE_LINKS,
    ...(flags["platform.billing"] ? [{ to: "/app/billing", label: "Facturation", end: false, icon: <Icon.bolt /> }] : []),
    ...(flags["platform.support"] ? [{ to: "/app/support", label: "Support", end: false, icon: <Icon.ticket /> }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-(--border) bg-zinc-950/60">
        <div className="mx-auto flex max-w-5xl min-w-0 items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <NavLink to="/" end className="shrink-0" aria-label="Accueil">
            <Wordmark />
          </NavLink>
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Espace client">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                    isActive ? "bg-(--primary-subtle) text-white" : "text-zinc-400 hover:bg-(--state-hover) hover:text-zinc-200"
                  }`
                }
              >
                <span className="hidden sm:inline-flex" aria-hidden>{l.icon}</span>
                {l.label}
              </NavLink>
            ))}
          </nav>
          {me.data && (
            <img src={avatarUrl(me.data.id, me.data.avatar, 64)} alt="" className="h-8 w-8 shrink-0 rounded-full ring-2 ring-zinc-800" />
          )}
        </div>
      </header>
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl px-4 py-10" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <div className="mt-6 space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  );
}
