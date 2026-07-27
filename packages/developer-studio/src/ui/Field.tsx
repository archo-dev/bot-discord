import type { ReactNode } from "react";

/** Labelled form field wrapper — extracted verbatim from App (M12). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      {children}
    </label>
  );
}
