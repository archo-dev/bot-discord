import type { RefObject } from "react";
import type { GuildOverview } from "@bot/shared";
import { guildIconUrl } from "../../lib/api.js";
import type { NavigationAvailability, NavigationDestination, NavigationRoute } from "../../navigation/registry.js";
import { GlobalSearch } from "./GlobalSearch.js";
import { Icon } from "../../ui/icons.js";
import { IconButton } from "../../ui/kit.js";

export function PanelTopbar({
  guildId,
  guild,
  destination,
  route,
  availability,
  menuButtonRef,
  drawerOpen,
  onOpenDrawer,
}: {
  guildId: string;
  guild: GuildOverview | undefined;
  destination: NavigationDestination;
  route: NavigationRoute | null;
  availability: NavigationAvailability;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}) {
  const iconUrl = guild ? guildIconUrl(guild.id, guild.icon, 64) : null;
  const title = destination.label;
  const description = route?.description ?? destination.description;

  return (
    <header className="sticky top-0 z-(--z-sticky) border-b border-zinc-800/80 bg-[rgba(12,10,17,0.9)] backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-6 xl:px-8">
        <IconButton
          ref={menuButtonRef}
          onClick={onOpenDrawer}
          className="-ml-1 lg:hidden"
          label="Ouvrir la navigation du serveur"
          aria-expanded={drawerOpen}
          aria-controls="guild-navigation-drawer"
        >
          <Icon.menu />
        </IconButton>

        <div className="flex min-w-0 items-center gap-2.5 sm:min-w-[180px] lg:min-w-[220px]">
          {guild ? (
            iconUrl ? (
              <img src={iconUrl} alt="" className="hidden h-8 w-8 shrink-0 rounded-lg sm:block lg:hidden" />
            ) : (
              <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-950 text-[10px] font-bold text-indigo-300 sm:flex lg:hidden">
                {guild.name.slice(0, 2).toUpperCase()}
              </span>
            )
          ) : null}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1 text-[11px] text-zinc-500">
              <span className="hidden max-w-28 truncate sm:inline">{guild?.name ?? "Serveur"}</span>
              <span className="hidden sm:inline" aria-hidden>/</span>
              <span className="truncate">
                {NAV_GROUP_LABELS[destination.group]}
                {route ? ` · ${route.label}` : ""}
              </span>
            </div>
            <h1 className="truncate font-display text-[15px] font-semibold text-zinc-100 sm:text-base">{title}</h1>
            <p className="sr-only">{description}</p>
          </div>
        </div>

        <div className="ml-auto flex min-w-0 flex-1 justify-end sm:justify-center">
          <GlobalSearch guildId={guildId} availability={availability} />
        </div>

        {guild?.access === "moderator" && (
          <span
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-900/60 bg-amber-950/60 px-2 text-[11px] font-medium text-amber-300"
            title="Accès modérateur : consultation uniquement."
          >
            <span className="[&_svg]:h-4 [&_svg]:w-4" aria-hidden><Icon.key /></span>
            <span className="hidden xl:inline">Lecture seule</span>
          </span>
        )}

        <span
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium ${
            guild?.gatewayConnected
              ? "border-emerald-900/60 bg-emerald-950/45 text-emerald-300"
              : "border-zinc-800 bg-zinc-900/75 text-zinc-400"
          }`}
          title={
            guild?.gatewayConnected
              ? "Gateway connectée : événements temps réel disponibles."
              : "Gateway non connectée : le panel reste disponible en mode HTTP."
          }
        >
          <span className={`h-2 w-2 rounded-full ${guild?.gatewayConnected ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
          <span className="hidden xl:inline" aria-hidden>{guild?.gatewayConnected ? "Gateway" : "Mode HTTP"}</span>
          <span className="sr-only">{guild?.gatewayConnected ? "Gateway connectée" : "Gateway non connectée, mode HTTP"}</span>
        </span>
      </div>
    </header>
  );
}

const NAV_GROUP_LABELS: Record<NavigationDestination["group"], string> = {
  home: "Accueil",
  community: "Communauté",
  moderation: "Modération",
  automation: "Automatisation",
  audio: "Audio",
  operations: "Pilotage",
};
