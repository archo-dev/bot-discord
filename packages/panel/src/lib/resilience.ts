export const STORAGE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredValue<T> {
  version: number;
  expiresAt?: number;
  value: T;
}

export function readStoredValue<T>(storage: StorageLike, key: string, validate: (value: unknown) => value is T, now = Date.now()): T | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as StoredValue<unknown>;
    if (parsed.version !== STORAGE_VERSION || !validate(parsed.value) || (parsed.expiresAt !== undefined && parsed.expiresAt <= now)) {
      storage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeStoredValue<T>(storage: StorageLike, key: string, value: T, expiresAt?: number): boolean {
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, ...(expiresAt === undefined ? {} : { expiresAt }), value }));
    return true;
  } catch {
    return false;
  }
}

export function normalizePanelRoute(value: string): string | null {
  if (value.length === 0 || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://panel.invalid");
    if (url.origin !== "https://panel.invalid") return null;
    if (/^\/(?:api|auth|studio(?:-api)?)(?:\/|$)/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

const RETURN_ROUTE_KEY = "panel:return-route:v1";
const RETURN_ROUTE_TTL_MS = 10 * 60_000;

export function rememberReturnRoute(route: string, storage: StorageLike = sessionStorage, now = Date.now()): boolean {
  const normalized = normalizePanelRoute(route);
  return normalized === null ? false : writeStoredValue(storage, RETURN_ROUTE_KEY, normalized, now + RETURN_ROUTE_TTL_MS);
}

export function consumeReturnRoute(storage: StorageLike = sessionStorage, now = Date.now()): string | null {
  const route = readStoredValue(storage, RETURN_ROUTE_KEY, (value): value is string => typeof value === "string" && normalizePanelRoute(value) !== null, now);
  try { storage.removeItem(RETURN_ROUTE_KEY); } catch { /* storage unavailable */ }
  return route === null ? null : normalizePanelRoute(route);
}

export function normalizeTelemetryRoute(pathname: string): string {
  return pathname
    .replace(/\/guilds\/\d{5,20}/g, "/guilds/:guildId")
    .replace(/\/tickets\/[^/]+/g, "/tickets/:id")
    .replace(/\/commands\/[^/]+/g, "/commands/:id")
    .replace(/\/automations\/[^/]+/g, "/automations/:id")
    .slice(0, 160);
}

export function createDiagnosticId(): string {
  try { return crypto.randomUUID(); } catch { return `diag-${Date.now().toString(36)}`; }
}
