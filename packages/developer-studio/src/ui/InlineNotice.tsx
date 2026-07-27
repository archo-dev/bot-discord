import type { ReactNode } from "react";

type NoticeTone = "info" | "success" | "warning" | "error";

const TONE: Record<NoticeTone, string> = {
  info: "border-indigo-900/60 bg-indigo-950/40 text-indigo-200",
  success: "border-green-900/60 bg-green-950/40 text-green-200",
  warning: "border-amber-900/60 bg-amber-950/40 text-amber-200",
  error: "border-red-900/60 bg-red-950/40 text-red-200",
};

/** Non-blocking inline banner (Lot 4) — e.g. step-up hint, refresh failure. */
export function InlineNotice({
  tone = "info",
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${TONE[tone]} ${className ?? ""}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
