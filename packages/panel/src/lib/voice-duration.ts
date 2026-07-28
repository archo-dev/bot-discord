import { readStoredValue, type StorageLike, writeStoredValue } from "./resilience.js";

export type VoiceDurationUnit = "auto" | "minutes" | "hours" | "days";

export const VOICE_DURATION_UNIT_KEY = "panel:stats:voice-duration-unit:v1";

const isVoiceDurationUnit = (value: unknown): value is VoiceDurationUnit =>
  value === "auto" || value === "minutes" || value === "hours" || value === "days";

const integerFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function normalizedSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function formatVoiceDuration(value: number, unit: VoiceDurationUnit): string {
  const secondsTotal = normalizedSeconds(value);
  const totalMinutes = Math.floor(secondsTotal / 60);
  const totalHours = Math.floor(secondsTotal / 3_600);
  const totalDays = Math.floor(secondsTotal / 86_400);
  const seconds = secondsTotal % 60;
  const minutes = totalMinutes % 60;
  const hours = totalHours % 24;

  if (unit === "minutes" || (unit === "auto" && secondsTotal < 3_600)) {
    return `${integerFormat.format(totalMinutes)} min ${seconds} s`;
  }
  if (unit === "hours" || (unit === "auto" && secondsTotal < 86_400)) {
    return `${integerFormat.format(totalHours)} h ${minutes} min ${seconds} s`;
  }
  return `${integerFormat.format(totalDays)} j ${hours} h ${minutes} min ${seconds} s`;
}

export function readVoiceDurationUnit(storage: StorageLike): VoiceDurationUnit {
  try {
    return readStoredValue(storage, VOICE_DURATION_UNIT_KEY, isVoiceDurationUnit) ?? "auto";
  } catch {
    return "auto";
  }
}

export function writeVoiceDurationUnit(storage: StorageLike, unit: VoiceDurationUnit): boolean {
  return writeStoredValue(storage, VOICE_DURATION_UNIT_KEY, unit);
}
