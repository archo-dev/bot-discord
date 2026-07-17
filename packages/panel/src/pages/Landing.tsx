import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MODULE_REGISTRY, type ModuleId, type OnboardingInvite } from "@bot/shared";
import { api } from "../lib/api.js";
import { Icon, type IconName } from "../ui/icons.js";

/* Modules mis en avant sur la vitrine (registre M03 = source de vérité). */
const FEATURED: readonly ModuleId[] = ["welcome", "automod", "levels", "tickets", "music", "temp_voice", "starboard", "stats"];

const DiscordMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.05a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.3a.07.07 0 0 1 .08 0 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .13 12.3 12.3 0 0 1-1.88.89.08.08 0 0 0-.04.11c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.03-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42z" />
  </svg>
);

function FeatureCard({ id }: { id: ModuleId }) {
  const module = MODULE_REGISTRY[id];
  const IconComponent = Icon[module.panel.icon as IconName] ?? Icon.bolt;
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-[linear-gradient(145deg,rgba(24,29,44,0.9),rgba(17,21,33,0.9))] p-5 shadow-(--shadow-sm)">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden>
        <IconComponent />
      </span>
      <h3 className="mt-4 font-semibold text-zinc-100">{module.publicName}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{module.description}</p>
    </div>
  );
}

export function Landing() {
  useEffect(() => {
    document.title = "Archodev — bot Discord tout-en-un";
  }, []);

  const invite = useQuery({
    queryKey: ["invite"],
    queryFn: () => api<OnboardingInvite>("/api/invite"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-3xl" aria-hidden />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-700 text-white shadow-(--shadow-primary)">
            <DiscordMark className="h-5 w-5 fill-current" />
          </span>
          <span className="font-semibold tracking-tight text-zinc-100">Archodev</span>
        </div>
        <a
          href="/auth/login"
          className="inline-flex h-9 items-center rounded-lg border border-zinc-700 px-4 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-(--surface-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Ouvrir le panel
        </a>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <section className="py-14 text-center sm:py-20">
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300">Panel Nocturne</div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
            Un seul bot pour animer, modérer et gérer votre serveur Discord.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Accueil, auto-modération, niveaux, tickets, musique et vocaux temporaires — activés à la carte depuis un
            panel web clair, sans quitter votre navigateur. Configuration guidée en moins de dix minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
            <a
              href="/auth/login"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 px-6 font-semibold text-zinc-100 transition hover:border-zinc-600 hover:bg-(--surface-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Se connecter avec Discord
            </a>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Permissions minimales, expliquées une par une lors de l'installation. Aucun accès administrateur global.
          </p>
        </section>

        <section className="pb-8">
          <h2 className="mb-6 text-center text-sm font-semibold uppercase tracking-wide text-zinc-500">Les modules</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURED.map((id) => <FeatureCard key={id} id={id} />)}
          </div>
        </section>

        <section className="mx-auto max-w-3xl py-12 text-center">
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-6 sm:p-8">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 mx-auto" aria-hidden>
              <Icon.shield />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-zinc-100">Respectueux de vos données</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Chaque serveur est isolé. Le bot ne lit pas le contenu de vos messages en dehors des modules que vous
              activez, ne les stocke pas et ne les partage avec aucun service tiers payant. Vous gardez le contrôle de
              chaque permission et pouvez désactiver un module à tout moment sans perdre votre configuration.
            </p>
          </div>
        </section>
      </main>

      <footer className="relative mx-auto max-w-6xl px-4 py-8 text-center text-xs text-zinc-600 sm:px-6">
        Archodev · Panel Discord Nocturne
      </footer>
    </div>
  );
}
