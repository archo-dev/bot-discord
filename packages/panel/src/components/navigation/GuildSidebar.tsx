import { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router";
import type { GuildOverview, MeResponse } from "@bot/shared";
import { avatarUrl, guildIconUrl } from "../../lib/api.js";
import { readStoredValue, writeStoredValue } from "../../lib/resilience.js";
import {
  NAVIGATION_GROUPS,
  SIDEBAR_DESTINATIONS,
  navigationGroups,
  type NavigationAvailability,
  type NavigationDestination,
} from "../../navigation/registry.js";
import { Icon } from "../../ui/icons.js";
import { IconButton } from "../../ui/kit.js";
import { Skeleton } from "../../ui/skeleton.js";

const FAVORITES_KEY = "panel:navigation-favorites:v1";

export function GuildSidebar({
  guild,
  me,
  activeDestination,
  availability,
  onNavigate,
  onClose,
  onLogout,
  logoutPending,
}: {
  guild: GuildOverview | undefined;
  me: MeResponse;
  activeDestination: NavigationDestination;
  availability: NavigationAvailability;
  onNavigate: () => void;
  onClose: () => void;
  onLogout: () => void;
  logoutPending: boolean;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(NAVIGATION_GROUPS.map((group) => group.id)),
  );
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return readStoredValue(
        localStorage,
        FAVORITES_KEY,
        (value): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string"),
      ) ?? [];
    } catch {
      return [];
    }
  });
  const groups = useMemo(() => navigationGroups(availability), [availability]);
  const favoriteItems = useMemo(
    () => favorites
      .map((path) => SIDEBAR_DESTINATIONS.find((destination) => destination.primaryPath === path || destination.id === path))
      .filter((destination): destination is NavigationDestination => Boolean(destination)),
    [favorites],
  );

  useEffect(() => {
    setOpenGroups((current) => new Set(current).add(activeDestination.group));
  }, [activeDestination.group]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleFavorite = (path: string) => {
    setFavorites((current) => {
      const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
      try {
        writeStoredValue(localStorage, FAVORITES_KEY, next);
      } catch {
        // La navigation continue sans stockage persistant.
      }
      return next;
    });
  };

  const iconUrl = guild ? guildIconUrl(guild.id, guild.icon, 128) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-1 pt-2">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/75 p-2 shadow-(--shadow-sm)">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-[radial-gradient(circle_at_80%_0%,rgba(107,78,242,0.18),transparent_65%)]" aria-hidden />
          <div className="relative flex items-center gap-2.5">
            {guild ? (
              iconUrl ? (
                <img src={iconUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-950 text-xs font-bold text-indigo-300">
                  {guild.name.slice(0, 2).toUpperCase()}
                </span>
              )
            ) : (
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
            )}
            <div className="min-w-0 flex-1 lg:hidden xl:block">
              {guild ? (
                <>
                  <div className="truncate text-sm font-semibold text-zinc-100">{guild.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {guild.approximateMemberCount != null ? `${guild.approximateMemberCount} membres` : "Serveur Discord"}
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              )}
            </div>
            <Link
              to="/"
              aria-label="Changer de serveur"
              title="Changer de serveur"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:hidden xl:flex [&_svg]:h-4 [&_svg]:w-4"
            >
              <Icon.chevron />
            </Link>
            <IconButton
              label="Fermer la navigation"
              onClick={onClose}
              className="lg:hidden"
            >
              <Icon.close />
            </IconButton>
            <Link
              to="/"
              aria-label="Changer de serveur"
              title="Changer de serveur"
              className="absolute inset-0 hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:block xl:hidden"
            />
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2" aria-label="Pages du serveur">
        {favoriteItems.length > 0 && (
          <div className="mb-1 border-b border-zinc-800/70 pb-1">
            <div className="flex h-7 items-center gap-1.5 px-2 font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 lg:justify-center lg:px-0 xl:justify-start xl:px-2">
              <Icon.star />
              <span className="lg:hidden xl:inline">Favoris</span>
            </div>
            <div className="space-y-px">
              {favoriteItems.map((destination) => (
                <SidebarDestination
                  key={`favorite-${destination.id}`}
                  destination={destination}
                  active={false}
                  favorite
                  tooltipScope="favorite"
                  onNavigate={onNavigate}
                  onFavorite={() => toggleFavorite(destination.primaryPath)}
                />
              ))}
            </div>
          </div>
        )}

        {groups.map((group) => {
          const expanded = openGroups.has(group.id);
          const GroupIcon = Icon[group.icon];
          return (
            <section key={group.id} className="mt-1 first:mt-0" aria-labelledby={`nav-group-label-${group.id}`}>
              <button
                type="button"
                id={`nav-group-label-${group.id}`}
                aria-expanded={expanded}
                aria-controls={`nav-group-${group.id}`}
                onClick={() => toggleGroup(group.id)}
                title={group.label}
                className="group flex h-7 w-full items-center justify-between rounded-md px-2 font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 transition hover:bg-(--state-hover) hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:h-8 lg:justify-center lg:px-0 xl:h-6 xl:justify-between xl:px-2"
              >
                <span className="flex items-center gap-1.5">
                  <span className="hidden lg:inline xl:hidden [&_svg]:h-4 [&_svg]:w-4"><GroupIcon /></span>
                  <span className="lg:hidden xl:inline">{group.label}</span>
                </span>
                <span className={`transition-transform duration-(--motion-base) lg:hidden xl:inline ${expanded ? "rotate-180" : ""}`} aria-hidden>
                  <Icon.chevron />
                </span>
              </button>
              <div
                id={`nav-group-${group.id}`}
                aria-hidden={!expanded}
                inert={!expanded ? true : undefined}
                className={`grid transition-[grid-template-rows,opacity] duration-(--motion-base) ${
                  expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 space-y-px overflow-hidden">
                  {group.destinations.map((destination) => (
                    <SidebarDestination
                      key={destination.id}
                      destination={destination}
                      active={destination.id === activeDestination.id}
                      favorite={favorites.includes(destination.primaryPath)}
                      onNavigate={onNavigate}
                      onFavorite={() => toggleFavorite(destination.primaryPath)}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </nav>

      <div
        className={`mx-2 mb-1.5 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
          guild?.gatewayConnected
            ? "border-emerald-900/60 bg-emerald-950/35 text-emerald-300"
            : "border-zinc-800 bg-zinc-900/65 text-zinc-400"
        } lg:justify-center lg:px-0 xl:justify-start xl:px-2`}
        title={guild?.gatewayConnected ? "Gateway connectée" : "Gateway non connectée — mode HTTP"}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${guild?.gatewayConnected ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
        <span className="truncate lg:hidden xl:inline">{guild?.gatewayConnected ? "Gateway connectée" : "Mode HTTP"}</span>
      </div>

      <div
        className="m-2 mt-0 flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/75 p-2 shadow-(--shadow-sm)"
        title={`${me.globalName ?? me.username} — @${me.username}`}
      >
        <span className="relative shrink-0 lg:hidden xl:inline">
          <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-8 w-8 rounded-full" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-emerald-400" aria-hidden />
        </span>
        <button
          type="button"
          onClick={onLogout}
          disabled={logoutPending}
          aria-label={logoutPending ? "Déconnexion en cours" : `Déconnecter ${me.globalName ?? me.username}`}
          className="relative hidden h-8 w-8 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:block xl:hidden"
        >
          <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-8 w-8 rounded-full" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-emerald-400" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 lg:hidden xl:block">
          <div className="truncate text-[13px] font-medium text-zinc-100">{me.globalName ?? me.username}</div>
          <div className="truncate text-[11px] text-zinc-500">@{me.username}</div>
        </div>
        <IconButton
          label={logoutPending ? "Déconnexion en cours" : "Déconnexion"}
          danger
          disabled={logoutPending}
          aria-busy={logoutPending}
          onClick={onLogout}
          className="lg:hidden xl:inline-flex"
        >
          <Icon.logout />
        </IconButton>
      </div>
    </div>
  );
}

function SidebarDestination({
  destination,
  active,
  favorite,
  tooltipScope,
  onNavigate,
  onFavorite,
}: {
  destination: NavigationDestination;
  active: boolean;
  favorite: boolean;
  tooltipScope?: string;
  onNavigate: () => void;
  onFavorite: () => void;
}) {
  const DestinationIcon = Icon[destination.icon];
  const tooltipId = `nav-tooltip-${tooltipScope ? `${tooltipScope}-` : ""}${destination.id}`;
  return (
    <div className="group/item relative flex items-center">
      <NavLink
        to={destination.primaryPath}
        end={destination.primaryPath === ""}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={destination.label}
        aria-describedby={tooltipId}
        title={destination.label}
        className={`group/nav relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 pr-10 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:min-h-9 lg:justify-center lg:px-0 lg:pr-0 xl:min-h-8 xl:justify-start xl:px-2.5 xl:pr-10 ${
          active
            ? "bg-(--primary-subtle) font-semibold text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-(--primary)"
            : "text-zinc-400 hover:bg-(--state-hover) hover:text-zinc-200"
        }`}
      >
        <span className={`shrink-0 [&_svg]:h-[17px] [&_svg]:w-[17px] ${active ? "text-indigo-300" : "text-zinc-500"}`} aria-hidden>
          <DestinationIcon />
        </span>
        <span className="min-w-0 truncate lg:hidden xl:block">{destination.label}</span>
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+0.5rem)] z-(--z-tooltip) hidden whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 shadow-(--shadow-md) lg:block lg:invisible lg:group-hover/nav:visible lg:group-focus-visible/nav:visible xl:hidden"
        >
          {destination.label}
        </span>
      </NavLink>
      <button
        type="button"
        aria-label={favorite ? `Retirer ${destination.label} des favoris` : `Épingler ${destination.label}`}
        title={favorite ? "Désépingler" : "Épingler"}
        onClick={onFavorite}
        className={`absolute right-1 flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:hidden xl:flex [&_svg]:h-3.5 [&_svg]:w-3.5 ${
          favorite
            ? "text-indigo-300"
            : "text-zinc-600 opacity-0 hover:bg-(--state-hover) hover:text-zinc-300 group-hover/item:opacity-100 focus:opacity-100"
        }`}
      >
        <Icon.star />
      </button>
    </div>
  );
}
