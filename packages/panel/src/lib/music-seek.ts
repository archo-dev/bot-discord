export function clampSeekPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, position));
}

/** Server snapshots never move the thumb while the user is dragging. */
export function reconcileSeekDraft(
  draft: number,
  serverPosition: number,
  duration: number,
  interactionLocked: boolean,
): number {
  return interactionLocked ? draft : clampSeekPosition(serverPosition, duration);
}

/** A failed optimistic request returns to the latest authoritative position. */
export function rollbackSeekDraft(serverPosition: number, duration: number): number {
  return clampSeekPosition(serverPosition, duration);
}
