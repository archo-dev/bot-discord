import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuildOverview, MeResponse } from "@bot/shared";
import { GuildSidebar } from "../components/navigation/GuildSidebar.js";
import { PanelTopbar } from "../components/navigation/PanelTopbar.js";
import { abortPendingApiRequests, api, ApiError } from "../lib/api.js";
import { AccessContext } from "../lib/access.js";
import { getPlatformFlags } from "../lib/flags.js";
import { MemberResolveProvider } from "../lib/members.js";
import {
  isValidGuildId,
  resolveNavigation,
  routeMatches,
  subnavRoutes,
  type NavigationAvailability,
} from "../navigation/registry.js";
import { ChunkErrorBoundary } from "../ui/error-boundary.js";
import { ErrorCard } from "../ui/kit.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export { isValidGuildId } from "../navigation/registry.js";

export interface GuildOutletContext {
  readonly guild: GuildOverview | undefined;
  readonly availability: NavigationAvailability;
  readonly guildUpdatedAt: number;
  readonly refreshGuild: () => Promise<unknown>;
}

export function GuildLayout({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const { guildId } = useParams<{ guildId: string }>();
  const validGuildId = isValidGuildId(guildId);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopNavigation, setDesktopNavigation] = useState(
    () => typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches,
  );
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const flags = useMemo(() => getPlatformFlags(), []);

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: ({ signal }) => api<GuildOverview>(`/api/guilds/${guildId}`, { signal }),
    enabled: validGuildId,
  });
  const logout = useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    meta: { errorMessage: "La déconnexion a échoué — réessayez." },
    onSuccess: () => {
      abortPendingApiRequests();
      queryClient.clear();
      window.location.assign("/");
    },
  });

  const guild = overview.data;
  const base = `/guilds/${guildId}`;
  const relativePath = location.pathname.startsWith(base)
    ? location.pathname.slice(base.length).replace(/^\/+|\/+$/g, "")
    : "";
  const resolved = resolveNavigation(relativePath);
  const activeTitle = resolved.route?.label ?? resolved.destination.label;
  const tabs = subnavRoutes(resolved.destination);
  const availability = useMemo<NavigationAvailability>(
    () => ({
      canWrite: guild?.access === "admin",
      gatewayConnected: guild?.gatewayConnected === true,
      flags,
    }),
    [flags, guild?.access, guild?.gatewayConnected],
  );

  useEffect(() => {
    const media = matchMedia("(min-width: 1024px)");
    const update = () => {
      setDesktopNavigation(media.matches);
      if (media.matches) setDrawerOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.title = guild ? `${activeTitle} — ${guild.name}` : activeTitle;
    return () => {
      document.title = "Panel du bot";
    };
  }, [activeTitle, guild]);

  useEffect(() => {
    if (!drawerOpen || desktopNavigation) return;
    const panel = drawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [desktopNavigation, drawerOpen]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (!validGuildId) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorCard message="L’identifiant du serveur est invalide." />
        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-indigo-400 hover:underline">← Retour à mes serveurs</Link>
        </div>
      </div>
    );
  }

  if (overview.isError) {
    const error = overview.error;
    const message =
      error instanceof ApiError && error.status === 404
        ? "Le bot n'est pas (ou plus) installé sur ce serveur."
        : error instanceof ApiError && error.status === 403
          ? "Vous n'avez pas accès au panel de ce serveur."
          : "Erreur lors du chargement du serveur.";
    const canRetry = !(error instanceof ApiError && (error.status === 403 || error.status === 404));
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorCard message={message} onRetry={canRetry ? () => void overview.refetch() : undefined} />
        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-indigo-400 hover:underline">← Retour à mes serveurs</Link>
        </div>
      </div>
    );
  }

  return (
    <MemberResolveProvider guildId={guildId}>
      <AccessContext.Provider value={{ canWrite: availability.canWrite }}>
        <div className="min-h-screen lg:flex">
          <aside
            id="guild-navigation-drawer"
            ref={drawerRef}
            role={!desktopNavigation && drawerOpen ? "dialog" : undefined}
            aria-modal={!desktopNavigation && drawerOpen ? "true" : undefined}
            aria-label="Navigation du serveur"
            aria-hidden={!desktopNavigation && !drawerOpen}
            inert={!desktopNavigation && !drawerOpen ? true : undefined}
            className={`fixed inset-y-0 left-0 z-(--z-drawer) h-[100dvh] max-h-[100dvh] w-[min(280px,calc(100vw-2rem))] border-r border-zinc-800 bg-(--surface-sidebar) shadow-(--shadow-lg) transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-h-screen lg:w-[72px] lg:translate-x-0 lg:shadow-none xl:w-[252px] ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <GuildSidebar
              guild={guild}
              me={me}
              activeDestination={resolved.destination}
              availability={availability}
              onNavigate={() => setDrawerOpen(false)}
              onClose={() => setDrawerOpen(false)}
              onLogout={() => logout.mutate()}
              logoutPending={logout.isPending}
            />
          </aside>

          {drawerOpen && !desktopNavigation && (
            <button
              type="button"
              aria-label="Fermer la navigation"
              className="fixed inset-0 z-[25] cursor-default bg-[rgba(6,7,14,0.74)]"
              onClick={() => setDrawerOpen(false)}
            />
          )}

          <div className="min-w-0 flex-1">
            <PanelTopbar
              guildId={guildId}
              guild={guild}
              destination={resolved.destination}
              route={resolved.route}
              availability={availability}
              menuButtonRef={menuButtonRef}
              drawerOpen={drawerOpen}
              onOpenDrawer={() => setDrawerOpen(true)}
            />

            <main className="min-w-0">
              <div className="mx-auto max-w-[1460px] px-4 py-4 sm:px-5 lg:px-6 xl:px-8">
                {tabs.length > 1 && (
                  <nav
                    aria-label={`Sections de ${resolved.destination.label}`}
                    className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800/80"
                  >
                    {tabs.map((tab) => {
                      const selected = routeMatches(tab.path, relativePath);
                      return (
                        <Link
                          key={tab.path}
                          to={tab.path}
                          aria-current={selected ? "page" : undefined}
                          className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                            selected
                              ? "border-indigo-500 text-zinc-100"
                              : "border-transparent text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {tab.label}
                        </Link>
                      );
                    })}
                  </nav>
                )}

                <div key={location.pathname} className="animate-page-in">
                  <ChunkErrorBoundary zone="guild" resetKey={location.pathname}>
                    <Suspense fallback={<SkeletonSettingsPage />}>
                      <Outlet
                        context={{
                          guild,
                          availability,
                          guildUpdatedAt: overview.dataUpdatedAt,
                          refreshGuild: () => overview.refetch(),
                        } satisfies GuildOutletContext}
                      />
                    </Suspense>
                  </ChunkErrorBoundary>
                </div>
              </div>
            </main>
          </div>
        </div>
      </AccessContext.Provider>
    </MemberResolveProvider>
  );
}
