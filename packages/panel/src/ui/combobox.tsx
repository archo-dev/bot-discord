import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Combobox « Nocturne 2 » (docs/design_system_v2.md §4.12) : select avec recherche,
 * pattern ARIA complet (rôle combobox + listbox, activedescendant, flèches/Entrée/Échap,
 * trap léger via clic extérieur). Deux modes :
 *   - statique : on passe toutes les `options`, le filtrage se fait côté client ;
 *   - asynchrone : on passe `onSearch` (les `options` sont affichées telles quelles
 *     et `selectedOption` fournit le libellé de la valeur courante hors liste).
 */

export interface ComboOption {
  id: string;
  label: string;
  /** Texte additionnel pris en compte par le filtrage client. */
  keywords?: string;
  /** Visuel de tête (# de salon, pastille de rôle, avatar). */
  leading?: ReactNode;
  /** Texte secondaire discret à droite. */
  meta?: ReactNode;
}

interface ComboboxProps {
  value: string | null;
  onChange: (id: string | null) => void;
  options: ComboOption[];
  placeholder?: string;
  /** Mode asynchrone : le parent filtre et fournit les `options`. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  invalid?: boolean;
  emptyText?: string;
  id?: string;
  className?: string;
  /** Libellé de la valeur courante quand elle n'est pas dans `options` (mode async). */
  selectedOption?: ComboOption | null;
}

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Rechercher…",
  onSearch,
  loading = false,
  disabled = false,
  clearable = false,
  invalid = false,
  emptyText = "Aucun résultat.",
  id,
  className = "",
  selectedOption = null,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const async = onSearch !== undefined;

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? (selectedOption?.id === value ? selectedOption : null),
    [options, value, selectedOption],
  );

  const filtered = useMemo(() => {
    if (async) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.label + " " + (o.keywords ?? "")).toLowerCase().includes(q));
  }, [async, options, query]);

  // Ferme au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) setActive(0);
  }, [open, filtered.length]);

  function openMenu() {
    if (disabled) return;
    setQuery("");
    if (async) onSearch("");
    setOpen(true);
  }

  function pick(opt: ComboOption) {
    onChange(opt.id);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
      else setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const showValue = !open && selected;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        className={`flex items-center gap-2 rounded-lg border bg-(--surface-2) px-3 text-sm transition focus-within:ring-2 focus-within:ring-indigo-500/40 ${
          invalid ? "border-(--danger)" : "border-zinc-700 focus-within:border-indigo-500"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <span className="shrink-0 text-zinc-500">{showValue && selected?.leading ? selected.leading : <SearchIcon />}</span>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-opt-${active}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          className="h-10 w-full min-w-0 bg-transparent text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          placeholder={showValue ? "" : selected ? selected.label : placeholder}
          value={open ? query : selected ? selected.label : ""}
          onFocus={openMenu}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            if (async) onSearch(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(false);
            }}
            aria-label="Effacer la sélection"
            className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-700 bg-(--surface-2) py-1 shadow-xl"
        >
          {loading && <li className="px-3 py-2 text-sm text-zinc-500">Recherche…</li>}
          {!loading && filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">{async && query.trim() === "" ? "Tapez pour rechercher…" : emptyText}</li>
          )}
          {!loading &&
            filtered.map((opt, i) => (
              <li
                key={opt.id}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={opt.id === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // garde le focus input, évite le blur avant le clic
                  pick(opt);
                }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                  i === active ? "bg-indigo-500/15 text-white" : "text-zinc-200"
                }`}
              >
                {opt.leading && <span className="flex shrink-0 items-center text-zinc-400">{opt.leading}</span>}
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.meta && <span className="shrink-0 text-xs text-zinc-500">{opt.meta}</span>}
                {opt.id === value && (
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-indigo-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
