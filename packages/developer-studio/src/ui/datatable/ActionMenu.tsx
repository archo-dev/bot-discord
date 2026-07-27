import { useEffect, useRef, useState } from "react";

export interface ActionItem {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/**
 * Row action menu ("…"): opens a role=menu popover. Keyboard: ArrowDown opens
 * and focuses the first item, Up/Down navigate, Escape closes and returns focus
 * to the trigger, outside click closes. Items are already permission-filtered by
 * the caller — an empty list renders nothing.
 */
export function ActionMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();

    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
      if (all.length === 0) return;
      e.preventDefault();
      const idx = all.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (idx + 1) % all.length : (idx - 1 + all.length) % all.length;
      all[next]?.focus();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const choose = (item: ActionItem) => {
    setOpen(false);
    btnRef.current?.focus();
    item.onClick();
  };

  return (
    <div className="relative inline-block text-left">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="grid size-7 place-items-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:bg-zinc-800"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => choose(item)}
              className={`block w-full rounded px-2.5 py-1.5 text-left text-sm disabled:opacity-40 ${
                item.tone === "danger"
                  ? "text-red-300 hover:bg-red-950/50"
                  : "text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
