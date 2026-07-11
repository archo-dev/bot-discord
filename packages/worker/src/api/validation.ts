import type { Context } from "hono";
import { z } from "zod";

/**
 * Réponse 400 « invalid_body » enrichie des erreurs zod par champ (plan UX E5).
 * Le panel mappe `fields` sous les champs de formulaire (`Field` avec prop `error`) ;
 * les clés sont celles du schéma zod, donc celles des DTOs `@bot/shared`.
 */
export function invalidBody(c: Context, error: z.ZodError) {
  return c.json({ error: "invalid_body", fields: z.flattenError(error).fieldErrors }, 400);
}
