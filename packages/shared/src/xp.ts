/**
 * Level curve (MEE6-style): going from level n to n+1 costs 5n² + 50n + 100 XP.
 * Shared between the Worker (level computation, /rank) and the panel (progress bars).
 */

/** XP needed to advance from `level` to `level + 1`. */
export function xpForNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total XP accumulated when `level` is reached. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let n = 0; n < level; n++) total += xpForNextLevel(n);
  return total;
}

/** Level reached with `xp` total XP. */
export function levelFromXp(xp: number): number {
  let level = 0;
  let rest = xp;
  while (rest >= xpForNextLevel(level)) {
    rest -= xpForNextLevel(level);
    level++;
  }
  return level;
}
