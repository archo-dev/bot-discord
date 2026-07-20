import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@bot/shared";
import { api } from "../../lib/api.js";
import { Button, IconButton } from "../../ui/kit.js";
import { Icon } from "../../ui/icons.js";
import { Wordmark } from "../../ui/brand.js";
import { PublicNav } from "./PublicNav.js";

/*
 * En-tête public (M2) : marque + navigation + état de connexion.
 * Lit ["me"] (partagé avec App via react-query) : 401 → « Se connecter »,
 * succès → « Ouvrir le panel ». Menu mobile repliable, fermé à Échap.
 */
export function PublicHeader() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeResponse>("/api/me"), retry: false });
  const isAuthed = me.isSuccess;
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-(--z-sticky) border-b border-zinc-800/70 bg-[rgba(12,10,17,0.82)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <Link to="/" aria-label="Accueil Archodev" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
          <Wordmark size={28} textClassName="text-[17px]" />
        </Link>

        <div className="hidden md:block">
          <PublicNav />
        </div>

        <div className="flex items-center gap-2">
          <Button href={isAuthed ? "/" : "/auth/login"} variant="secondary" size="sm">
            {isAuthed ? "Ouvrir le panel" : "Se connecter"}
          </Button>
          <IconButton
            ref={menuButtonRef}
            className="md:hidden"
            label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            aria-controls="public-mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <Icon.close /> : <Icon.menu />}
          </IconButton>
        </div>
      </div>

      {open && (
        <div id="public-mobile-menu" className="border-t border-zinc-800/70 px-4 py-3 md:hidden">
          <PublicNav orientation="vertical" onNavigate={() => setOpen(false)} />
        </div>
      )}
    </header>
  );
}
