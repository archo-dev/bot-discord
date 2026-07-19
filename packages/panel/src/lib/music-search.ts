export const MUSIC_SEARCH_DEBOUNCE_MS = 400;
export const MUSIC_SEARCH_MAX_LENGTH = 500;

/** Owns at most one browser request and rejects results from obsolete searches. */
export class MusicSearchCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): { signal: AbortSignal; isCurrent: () => boolean } {
    this.controller?.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted && this.generation === generation,
    };
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation++;
  }
}

/** Synchronous guard closes the gap before React exposes mutation.isPending. */
export class MusicSubmissionGuard {
  private active = false;

  begin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  end(): void {
    this.active = false;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
