import type { PlatformFlagKey } from "@bot/shared";
import {
  NAVIGATION_GROUPS,
  NAVIGATION_REGISTRY,
  isDestinationAvailable,
  type NavigationAccess,
  type NavigationAvailability,
  type SearchResultKind,
} from "./registry.js";

export interface GlobalSearchEntry {
  readonly id: string;
  readonly kind: SearchResultKind;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly groupLabel: string;
  readonly keywords: readonly string[];
  readonly access: NavigationAccess;
}

const groupLabel = (id: string) => NAVIGATION_GROUPS.find((group) => group.id === id)?.label ?? "";

export function buildSearchIndex(availability: NavigationAvailability): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];

  for (const destination of NAVIGATION_REGISTRY) {
    if (!isDestinationAvailable(destination, availability)) continue;
    entries.push({
      id: `destination.${destination.id}`,
      kind: destination.searchKind === "module" ? "Modules" : "Pages",
      label: destination.label,
      description: destination.description,
      path: destination.primaryPath,
      groupLabel: groupLabel(destination.group),
      keywords: destination.keywords,
      access: destination.access,
    });

    for (const route of destination.secondaryRoutes) {
      if (route.indexable === false) continue;
      const access = route.access ?? destination.access;
      const gateway = route.gateway ?? destination.gateway;
      if (access === "write" && !availability.canWrite) continue;
      if (gateway === "required" && !availability.gatewayConnected && route.kind === "Actions") continue;
      entries.push({
        id: `route.${destination.id}.${route.path}`,
        kind: route.kind ?? "Pages",
        label: route.label,
        description: route.description ?? destination.description,
        path: route.path,
        groupLabel: groupLabel(destination.group),
        keywords: [...destination.keywords, ...(route.keywords ?? [])],
        access,
      });
    }

    for (const [kind, targets] of [["Paramètres", destination.settings], ["Actions", destination.actions]] as const) {
      for (const item of targets) {
        if (item.access === "write" && !availability.canWrite) continue;
        if (item.gateway === "required" && !availability.gatewayConnected) continue;
        entries.push({
          id: `${kind === "Actions" ? "action" : "setting"}.${item.id}`,
          kind,
          label: item.label,
          description: item.description,
          path: item.path,
          groupLabel: groupLabel(destination.group),
          keywords: [...destination.keywords, ...item.keywords],
          access: item.access,
        });
      }
    }
  }

  return entries;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .trim();
}

export function searchGlobalIndex(entries: readonly GlobalSearchEntry[], query: string, limit = 24): GlobalSearchEntry[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return entries.filter((entry) => entry.kind === "Pages" || entry.kind === "Modules").slice(0, limit);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return entries
    .map((entry) => {
      const label = normalizeSearchText(entry.label);
      const keywords = normalizeSearchText(entry.keywords.join(" "));
      const description = normalizeSearchText(entry.description);
      if (!tokens.every((token) => label.includes(token) || keywords.includes(token) || description.includes(token))) {
        return { entry, score: -1 };
      }
      const score = (label === normalizedQuery ? 100 : label.startsWith(normalizedQuery) ? 70 : label.includes(normalizedQuery) ? 50 : 0)
        + tokens.reduce((total, token) => total + (label.includes(token) ? 12 : keywords.includes(token) ? 6 : 2), 0);
      return { entry, score };
    })
    .filter((result) => result.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label, "fr"))
    .slice(0, limit)
    .map((result) => result.entry);
}

export const SEARCH_GROUP_ORDER: readonly SearchResultKind[] = ["Pages", "Modules", "Paramètres", "Actions"];

export function nextSearchIndex(current: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End", count: number): number {
  if (count <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const direction = key === "ArrowDown" ? 1 : -1;
  return (current + direction + count) % count;
}

export function emptyFlagState(): Readonly<Partial<Record<PlatformFlagKey, boolean>>> {
  return {};
}
