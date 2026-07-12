/** Helpers transverses du gateway. */

/** Message loggable d'une erreur attrapée (les non-Error sont renvoyés tels quels). */
export function errMsg(err: unknown): unknown {
  return err instanceof Error ? err.message : err;
}
