import { MUSIC_SEARCH_MAX_LENGTH, MUSIC_SEARCH_MIN_LENGTH } from "@bot/shared";
import { ApiError } from "./api.js";

export { MUSIC_SEARCH_MAX_LENGTH, MUSIC_SEARCH_MIN_LENGTH };
export const MUSIC_SEARCH_DEBOUNCE_MS = 700;

export interface MusicSearchRequestHandle {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export type MusicSearchScheduleResult = "ignored" | "duplicate" | "scheduled";

export function normalizeMusicSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Owns at most one browser request and rejects results from obsolete searches. */
export class MusicSearchCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastInputKey: string | null = null;

  schedule(
    rawQuery: string,
    scope: string,
    run: (query: string, request: MusicSearchRequestHandle) => void,
  ): MusicSearchScheduleResult {
    const query = normalizeMusicSearchQuery(rawQuery);
    const inputKey = `${scope}\0${query}`;
    if (query.length < MUSIC_SEARCH_MIN_LENGTH) {
      this.cancel();
      this.lastInputKey = null;
      return "ignored";
    }
    if (inputKey === this.lastInputKey) return "duplicate";
    this.lastInputKey = inputKey;
    this.cancelActiveRequest();
    const generation = ++this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      const request = this.begin(generation);
      run(query, request);
    }, MUSIC_SEARCH_DEBOUNCE_MS);
    return "scheduled";
  }

  private begin(generation: number): MusicSearchRequestHandle {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted && this.generation === generation,
    };
  }

  cancel(): void {
    this.cancelActiveRequest();
    this.generation++;
  }

  private cancelActiveRequest(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
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

export function musicSearchErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = error.retryAfterSeconds ?? 60;
    return `Trop de recherches. Réessayez dans ${seconds} seconde${seconds > 1 ? "s" : ""}.`;
  }
  return error instanceof Error ? error.message : "Recherche indisponible.";
}
