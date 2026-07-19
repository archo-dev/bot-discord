import { useEffect, useState } from "react";
import { clampSeekPosition, reconcileSeekDraft, rollbackSeekDraft } from "../lib/music-seek.js";

function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function MusicSeekBar({
  value,
  duration,
  sequence,
  disabled,
  onSeek,
}: {
  value: number;
  duration: number;
  sequence: number;
  disabled: boolean;
  onSeek: (position: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => clampSeekPosition(value, duration));
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) => reconcileSeekDraft(current, value, duration, dragging || pending));
  }, [sequence, value, duration, dragging, pending]);

  const commit = async (rawPosition: number) => {
    if (disabled || pending) return;
    const position = clampSeekPosition(rawPosition, duration);
    setDraft(position);
    setPending(true);
    setError(null);
    try {
      await onSeek(position);
    } catch {
      setDraft(rollbackSeekDraft(value, duration));
      setError("Le déplacement a échoué. La position réelle a été restaurée.");
    } finally {
      setPending(false);
    }
  };

  const unavailable = disabled || duration <= 0;
  return (
    <div className="mt-4">
      <input
        type="range"
        min={0}
        max={Math.max(0, duration)}
        step={1}
        value={draft}
        disabled={unavailable || pending}
        aria-label="Position de lecture"
        aria-valuetext={`${formatDuration(draft)} sur ${formatDuration(duration)}`}
        className="h-2 w-full cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        onPointerDown={() => {
          setDragging(true);
          setError(null);
        }}
        onChange={(event) => setDraft(clampSeekPosition(Number(event.currentTarget.value), duration))}
        onPointerUp={(event) => {
          setDragging(false);
          void commit(Number(event.currentTarget.value));
        }}
        onPointerCancel={() => {
          setDragging(false);
          setDraft(rollbackSeekDraft(value, duration));
        }}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
            void commit(Number(event.currentTarget.value));
          }
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-zinc-500">
        <span>{formatDuration(draft)}</span>
        <span>{duration > 0 ? formatDuration(duration) : "live"}</span>
      </div>
      {pending && <p className="mt-1 text-xs text-indigo-300">Déplacement en cours…</p>}
      {error && <p className="mt-1 text-sm text-red-400" role="alert">{error}</p>}
    </div>
  );
}
