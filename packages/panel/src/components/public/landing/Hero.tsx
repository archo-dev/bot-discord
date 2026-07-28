import { Button } from "../../../ui/kit.js";

const DiscordMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.05a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.3a.07.07 0 0 1 .08 0 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1 0 .13 12.3 12.3 0 0 1-1.88.89.08.08 0 0 0-.04.11c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.03-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42z" />
  </svg>
);

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative text-center lg:text-left">
      <div className="mb-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">
        Panel Discord tout-en-un
      </div>
      <h1
        id="hero-title"
        className="mx-auto max-w-2xl font-display text-[2.55rem] font-semibold leading-[1.04] tracking-[-0.045em] text-zinc-50 sm:text-5xl lg:mx-0 lg:text-[3.25rem] xl:text-[3.75rem]"
      >
        Pilotez votre serveur Discord sans friction
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 lg:mx-0">
        Modération, communauté, automatisations et santé du serveur réunies dans une interface claire, rapide et
        immédiatement compréhensible.
      </p>
      <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
        <Button href="/auth/login" size="lg" className="whitespace-nowrap lg:px-4 xl:px-5">
          <DiscordMark className="h-5 w-5 fill-current" />
          Se connecter avec Discord
        </Button>
        <Button href="#apercu-panel" variant="secondary" size="lg" className="whitespace-nowrap lg:px-4 xl:px-5">
          Voir la démo
          <span aria-hidden>↓</span>
        </Button>
      </div>
      <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-zinc-400 lg:justify-start">
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-400" aria-hidden>✓</span>
          Configuration guidée
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-400" aria-hidden>✓</span>
          Responsive par défaut
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-400" aria-hidden>✓</span>
          Actions centralisées
        </li>
      </ul>
    </section>
  );
}
