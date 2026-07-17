export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    /** Erreurs zod par champ renvoyées par le Worker sur `invalid_body` (plan E5). */
    public readonly fields?: Record<string, string[] | undefined>,
  ) {
    super(`${status}: ${code}`);
    this.name = "ApiError";
  }
}

/* Les messages zod arrivent en anglais ; on traduit les motifs courants (microcopy D.S. v2 §7). */
function frenchifyZodMessage(msg: string): string {
  let m = /^Too big: expected string to have <=(\d+)/.exec(msg);
  if (m) return `Trop long — ${m[1]} caractères maximum.`;
  m = /^Too small: expected string to have >=(\d+)/.exec(msg);
  if (m) return Number(m[1]) <= 1 ? "Ce champ est requis." : `Trop court — ${m[1]} caractères minimum.`;
  m = /^Too big: expected number to be <=(\d+)/.exec(msg);
  if (m) return `Doit être au plus ${m[1]}.`;
  m = /^Too small: expected number to be >=(\d+)/.exec(msg);
  if (m) return `Doit être au moins ${m[1]}.`;
  if (msg.startsWith("Invalid") || msg.startsWith("Too")) return "Valeur invalide.";
  return msg;
}

/** Premier message d'erreur (traduit) pour un champ donné, si l'erreur en transporte. */
export function fieldError(error: unknown, field: string): string | undefined {
  const raw = error instanceof ApiError ? error.fields?.[field]?.[0] : undefined;
  return raw === undefined ? undefined : frenchifyZodMessage(raw);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let code = "error";
    let fields: Record<string, string[] | undefined> | undefined;
    try {
      const body = (await res.json()) as { error?: string; fields?: Record<string, string[] | undefined> };
      code = body.error ?? "error";
      fields = body.fields;
    } catch {
      // non-JSON error body
    }
    if (res.status === 401 && path !== "/api/me") window.dispatchEvent(new Event("panel:session-expired"));
    throw new ApiError(res.status, code, fields);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const guildIconUrl = (id: string, icon: string | null, size = 64): string | null =>
  icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=${size}` : null;

export const avatarUrl = (id: string, avatar: string | null, size = 64): string =>
  avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=${size}`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> 22n) % 6}.png`;
