import { useQuery } from "@tanstack/react-query";
import type { OnboardingInvite } from "@bot/shared";
import { api } from "../../../lib/api.js";
import { Button } from "../../../ui/kit.js";

const DiscordMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.05a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.3a.07.07 0 0 1 .08 0 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .13 12.3 12.3 0 0 1-1.88.89.08.08 0 0 0-.04.11c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.03-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42z" />
  </svg>
);

export function Hero() {
  const invite = useQuery({
    queryKey: ["invite"],
    queryFn: () => api<OnboardingInvite>("/api/invite"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <section aria-labelledby="hero-title" className="relative py-16 text-center sm:py-24">
      <div className="mb-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Panel Archodev</div>
      <h1 id="hero-title" className="mx-auto max-w-3xl font-display text-4xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-5xl">
        Animez, modérez et gérez votre serveur Discord — sans effort.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
        Accueil, auto-modération, niveaux, tickets, musique et vocaux temporaires, réunis dans un panel web clair.
        Passez moins de temps à gérer, plus de temps à faire grandir votre communauté.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {/* Exception assumée au kit (CTA marketing du hero, cf. ui/kit/DESIGN_TOKENS.md). */}
        <a
          href={invite.data?.url ?? "#"}
          aria-disabled={!invite.data}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-6 font-semibold text-white shadow-(--shadow-primary) transition hover:from-indigo-400 hover:to-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${invite.data ? "" : "pointer-events-none opacity-60"}`}
        >
          <DiscordMark className="h-5 w-5 fill-current" />
          Ajouter à mon serveur
        </a>
        <Button href="#offres" variant="secondary" size="lg">Voir les offres</Button>
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Gratuit pour commencer. Permissions minimales, expliquées une par une à l'installation.
      </p>
    </section>
  );
}
