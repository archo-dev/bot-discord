import { Icon } from "./icons.js";
import type { VizColor } from "./kit.js";

/** Métadonnées partagées pour l'affichage des actions de modération (Dashboard + Mod-log). */
export const ACTION_META: Record<string, { label: string; color: VizColor; icon: keyof typeof Icon }> = {
  ban: { label: "Ban", color: "red", icon: "gavel" },
  unban: { label: "Unban", color: "green", icon: "shield" },
  kick: { label: "Kick", color: "amber", icon: "logout" },
  timeout: { label: "Mute", color: "blue", icon: "bolt" },
  auto_timeout: { label: "Mute auto", color: "blue", icon: "bolt" },
  warn: { label: "Warn", color: "amber", icon: "shield" },
  unwarn: { label: "Warn révoqué", color: "gray", icon: "shield" },
  clear: { label: "Clear", color: "gray", icon: "scroll" },
};

export const vizHex: Record<VizColor, string> = {
  violet: "#7C4DEE",
  blue: "#3E7AFC",
  green: "#1FC069",
  amber: "#F0B114",
  red: "#ED4B4B",
  gray: "#4B5163",
};

export function actionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, color: "gray" as VizColor, icon: "scroll" as const };
}

/** Pastille ronde colorée + glyphe pour une action de modération. */
export function ModActionIcon({ action, size = 36 }: { action: string; size?: number }) {
  const meta = actionMeta(action);
  const Glyph = Icon[meta.icon];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ background: vizHex[meta.color], width: size, height: size }}
    >
      <Glyph />
    </span>
  );
}

function parseUtc(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : iso + "Z");
}

export function relativeTime(iso: string): string {
  const then = parseUtc(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d <= 7) return `il y a ${d} j`;
  // Au-delà de 7 jours : date absolue courte (D.S. v2 §6.7)
  return parseUtc(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function absoluteDate(iso: string): string {
  return parseUtc(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

/** Date relative doublée de la date absolue au survol (D.S. v2 §6.7). */
export function TimeAgo({ iso, className = "" }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={absoluteDate(iso)} className={className}>
      {relativeTime(iso)}
    </time>
  );
}
