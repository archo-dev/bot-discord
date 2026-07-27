import type { StudioPermission } from "@bot/shared";
import type { NavIconName } from "../components/NavIcon.js";

/** The Studio tabs (extracted verbatim from App — M12). */
export type Tab =
  | "overview"
  | "users"
  | "guilds"
  | "subscriptions"
  | "support"
  | "updates"
  | "grants"
  | "audit"
  | "metrics"
  | "errors"
  | "rollout";

export const TABS: Tab[] = [
  "overview",
  "users",
  "guilds",
  "subscriptions",
  "support",
  "updates",
  "grants",
  "audit",
  "metrics",
  "errors",
  "rollout",
];

/** Server re-checks every permission; this map is cosmetic tab-gating only. */
export const TAB_PERMISSION: Record<Exclude<Tab, "overview">, StudioPermission> = {
  users: "guilds.inspect",
  guilds: "guilds.inspect",
  subscriptions: "subscriptions.read",
  support: "support.manage",
  updates: "updates.publish",
  grants: "subscriptions.read",
  audit: "audit.read",
  metrics: "deployments.read",
  errors: "deployments.read",
  rollout: "deployments.read",
};

/** One entry in the grouped sidebar (Lot 2). `id` is the same routing key as
 * before; only presentation (icon, FR label, grouping) is added here. */
export interface NavItem {
  id: Tab;
  label: string;
  icon: NavIconName;
}

/** A titled group of nav entries; `label === null` for the ungrouped top item. */
export interface NavSection {
  label: string | null;
  items: NavItem[];
}

/**
 * Grouped navigation, matching the validated mockup
 * (docs/studio-mockup/nocturne-studio-mockup.html). This drives display order
 * and grouping only — membership of each entry is still gated by TAB_PERMISSION
 * via the same can(...) check in App, so no permission behaviour changes.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ id: "overview", label: "Vue d'ensemble", icon: "grid" }],
  },
  {
    label: "Exploitation",
    items: [
      { id: "guilds", label: "Guildes", icon: "server" },
      { id: "users", label: "Utilisateurs", icon: "users" },
      { id: "support", label: "Support", icon: "life" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { id: "subscriptions", label: "Abonnements", icon: "card" },
      { id: "grants", label: "Octrois", icon: "gift" },
    ],
  },
  {
    label: "Publication",
    items: [{ id: "updates", label: "Mises à jour", icon: "mega" }],
  },
  {
    label: "Système",
    items: [
      { id: "metrics", label: "Métriques", icon: "activity" },
      { id: "errors", label: "Erreurs", icon: "alert" },
      { id: "rollout", label: "Rollout", icon: "toggle" },
      { id: "audit", label: "Audit", icon: "shield" },
    ],
  },
];
