/** Small presentational time formatters (Lot 3). Pure, browser-locale FR. */

/** « il y a 12 s / 4 min / 2 h / 3 j ». « — » when null/invalid. */
export function relativeTimeFr(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `il y a ${secs} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/** « 14:32 » local time. « — » when null/invalid. */
export function fmtTimeFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** « 12 juil. 2026, 14:32 » — full FR date+time for tooltips. « — » when null. */
export function fullDateFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
