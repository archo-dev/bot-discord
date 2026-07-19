export interface SoundcloudFormatMetadata {
  format_id?: string;
  protocol?: string;
  format_note?: string;
  acodec?: string;
  abr?: number;
  ext?: string;
}

export interface SoundcloudPlaybackInput extends SoundcloudFormatMetadata {
  extractor?: string;
  availability?: string;
  formats?: SoundcloudFormatMetadata[];
}

export interface SoundcloudPlaybackClassification {
  classification: "preview" | "full" | "unknown";
  isPreview: boolean;
  previewReason: "selected_format_id" | "available_format_ids" | null;
  formatId: string | null;
  protocol: string | null;
  formatNote: string | null;
  acodec: string | null;
  abr: number | null;
  ext: string | null;
  extractor: string | null;
  availability: string | null;
}

interface SoundcloudMetadataCarrier {
  soundcloudPlayback?: SoundcloudPlaybackClassification;
  soundcloudPlaylistPlayback?: Array<{
    id: string;
    playback: SoundcloudPlaybackClassification;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPreviewFormatId(value: string | undefined): boolean {
  return typeof value === "string" && /(?:^|[_-])preview(?:$|[_-])/i.test(value);
}

/** Classifies only explicit yt-dlp format signals; duration is deliberately ignored. */
export function classifySoundcloudPlayback(info: SoundcloudPlaybackInput): SoundcloudPlaybackClassification {
  const formatIds = (info.formats ?? [])
    .map((format) => format.format_id)
    .filter((formatId): formatId is string => Boolean(formatId));
  const selectedPreview = isPreviewFormatId(info.format_id);
  const allAvailablePreview = !info.format_id && formatIds.length > 0 && formatIds.every(isPreviewFormatId);
  const hasKnownFormat = Boolean(info.format_id) || formatIds.length > 0;
  const isPreview = selectedPreview || allAvailablePreview;

  return {
    classification: isPreview ? "preview" : hasKnownFormat ? "full" : "unknown",
    isPreview,
    previewReason: selectedPreview
      ? "selected_format_id"
      : allAvailablePreview
        ? "available_format_ids"
        : null,
    formatId: info.format_id ?? null,
    protocol: info.protocol ?? null,
    formatNote: info.format_note ?? null,
    acodec: info.acodec ?? null,
    abr: info.abr ?? null,
    ext: info.ext ?? null,
    extractor: info.extractor ?? null,
    availability: info.availability ?? null,
  };
}

/** Adds bounded, non-sensitive per-track data without retaining formats or stream URLs. */
export function withSoundcloudPlaybackMetadata<T>(
  metadata: T | undefined,
  playback: SoundcloudPlaybackClassification,
): T {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    soundcloudPlayback: playback,
  } as T;
}

export function withSoundcloudPlaylistPlaybackMetadata<T>(
  metadata: T | undefined,
  tracks: Array<{ id: string; playback: SoundcloudPlaybackClassification }>,
): T {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    soundcloudPlaylistPlayback: tracks,
  } as T;
}

export function getSoundcloudPlaybackMetadata(
  metadata: unknown,
  trackId?: string,
): SoundcloudPlaybackClassification | undefined {
  if (!isRecord(metadata)) return undefined;
  const carrier = metadata as SoundcloudMetadataCarrier;
  const playback = carrier.soundcloudPlayback ??
    (trackId ? carrier.soundcloudPlaylistPlayback?.find((track) => track.id === trackId)?.playback : undefined);
  if (!playback || typeof playback !== "object") return undefined;
  if (!(["preview", "full", "unknown"] as const).includes(playback.classification)) return undefined;
  return playback;
}
