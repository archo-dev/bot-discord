/**
 * Nav icons (Lot 2). Line-art SVG paths lifted verbatim from the validated
 * mockup (docs/studio-mockup/nocturne-studio-mockup.html). Presentational only.
 */
export type NavIconName =
  | "grid"
  | "server"
  | "users"
  | "life"
  | "card"
  | "gift"
  | "mega"
  | "activity"
  | "alert"
  | "toggle"
  | "shield";

const PATHS: Record<NavIconName, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  server:
    "M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87",
  life:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8ZM5 5l4.2 4.2M14.8 14.8 19 19M19 5l-4.2 4.2M9.2 14.8 5 19",
  card: "M2 5h20v14H2zM2 10h20",
  gift:
    "M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S11 3 8.5 3 6 5 6 5s.8 2 2.5 2H12ZM12 7s1-4 3.5-4S18 5 18 5s-.8 2-2.5 2H12Z",
  mega:
    "M3 11v3a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1ZM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14",
  activity: "M22 12h-4l-3 8-6-16-3 8H2",
  alert:
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01",
  toggle: "M1 6h22v12H1zM16 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z",
  shield:
    "M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4ZM9 12l2 2 4-4",
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
