import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { NavigationAvailability } from "../../navigation/registry.js";
import {
  buildSearchIndex,
  nextSearchIndex,
  SEARCH_GROUP_ORDER,
  searchGlobalIndex,
  type GlobalSearchEntry,
} from "../../navigation/search-index.js";
import { Icon } from "../../ui/icons.js";
import { Modal } from "../../ui/overlay.js";

export function GlobalSearch({
  guildId,
  availability,
}: {
  guildId: string;
  availability: NavigationAvailability;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const index = useMemo(() => buildSearchIndex(availability), [availability]);
  const matched = useMemo(() => searchGlobalIndex(index, query), [index, query]);
  const results = useMemo(
    () => SEARCH_GROUP_ORDER.flatMap((kind) => matched.filter((entry) => entry.kind === kind)),
    [matched],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("fr-FR") === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = (entry: GlobalSearchEntry) => {
    const destination = entry.path ? `/guilds/${guildId}/${entry.path}` : `/guilds/${guildId}`;
    close();
    void navigate(destination);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const key = event.key;
      setActiveIndex((current) => nextSearchIndex(current, key, results.length));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex((current) => nextSearchIndex(current, "Home", results.length));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex((current) => nextSearchIndex(current, "End", results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) select(selected);
    }
  };

  let renderedIndex = 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir la recherche globale"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-9 min-w-9 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/75 px-2.5 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 sm:w-full sm:max-w-[420px] sm:px-3"
      >
        <span className="[&_svg]:h-4 [&_svg]:w-4" aria-hidden><Icon.search /></span>
        <span className="hidden min-w-0 flex-1 truncate text-left text-[13px] sm:block">
          Rechercher une page, un module ou une action…
        </span>
        <kbd className="hidden shrink-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-sans text-[10px] text-zinc-500 md:inline">
          Ctrl K
        </kbd>
      </button>

      {open && createPortal(<Modal open onClose={close} title="Recherche globale" size="2xl">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
            <Icon.search />
          </span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-results"
            aria-activedescendant={results[activeIndex] ? `global-search-${results[activeIndex].id}` : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Rechercher une page, un module ou une action…"
            className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-10 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-zinc-500">
          <span>{query ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : "Suggestions"}</span>
          <span className="hidden sm:inline">↑ ↓ naviguer · Entrée ouvrir · Échap fermer</span>
        </div>

        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          aria-label="Résultats de recherche"
          className="mt-2 max-h-[55vh] overflow-y-auto pr-1"
        >
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500">
                <Icon.search />
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-300">Aucun résultat accessible</p>
              <p className="mt-1 text-xs text-zinc-500">Essayez un module, un réglage ou un synonyme.</p>
            </div>
          ) : (
            SEARCH_GROUP_ORDER.map((kind) => {
              const group = results.filter((entry) => entry.kind === kind);
              if (group.length === 0) return null;
              return (
                <section key={kind} aria-labelledby={`search-group-${kind}`} className="mt-3 first:mt-0">
                  <h3 id={`search-group-${kind}`} className="px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    {kind}
                  </h3>
                  <div className="space-y-1">
                    {group.map((entry) => {
                      const indexForEntry = renderedIndex++;
                      const active = indexForEntry === activeIndex;
                      return (
                        <button
                          key={entry.id}
                          id={`global-search-${entry.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-search-index={indexForEntry}
                          onMouseMove={() => setActiveIndex(indexForEntry)}
                          onClick={() => select(entry)}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                            active
                              ? "border-indigo-500/40 bg-indigo-500/12 text-zinc-100"
                              : "border-transparent text-zinc-300 hover:bg-(--state-hover)"
                          }`}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-indigo-300" aria-hidden>
                            {entry.kind === "Modules" ? <Icon.bolt /> : entry.kind === "Paramètres" ? <Icon.sliders /> : entry.kind === "Actions" ? <Icon.workflow /> : <Icon.panel />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{entry.label}</span>
                            <span className="mt-0.5 block truncate text-xs text-zinc-500">{entry.description}</span>
                          </span>
                          <span className="hidden shrink-0 text-[11px] text-zinc-600 sm:block">{entry.groupLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </Modal>, document.body)}
    </>
  );
}
