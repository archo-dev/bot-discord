import { MODULE_REGISTRY } from "@bot/shared";
import { Button } from "../../../ui/kit.js";
import { Icon, type IconName } from "../../../ui/icons.js";
import { BENEFITS, USE_CASES, FEATURED_MODULES } from "./data.js";

/* Aperçu purement illustratif : aucune métrique n'est présentée comme réelle. */
export function PanelPreview() {
  return (
    <section
      id="apercu-panel"
      aria-labelledby="preview-title"
      aria-describedby="preview-summary"
      className="min-w-0 scroll-mt-24"
    >
      <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
        <span className="text-indigo-400" aria-hidden>◇</span>
        <h2 id="preview-title" className="font-medium text-zinc-300">Aperçu du panel</h2>
        <span className="rounded-full border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          Démonstration
        </span>
      </div>

      <div
        className="overflow-hidden rounded-[1.4rem] border border-indigo-500/25 bg-[#12101a]/95 p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.38)] sm:p-3"
        aria-hidden
      >
        <div className="overflow-hidden rounded-[1rem] border border-zinc-800 bg-[#0d0c13]">
          <div className="flex h-9 items-center gap-1.5 border-b border-zinc-800 px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
            <span className="ml-3 h-2 w-20 rounded-full bg-zinc-800" />
          </div>

          <div className="grid min-h-[250px] grid-cols-[76px_1fr] sm:min-h-[292px] sm:grid-cols-[104px_1fr]">
            <div className="border-r border-zinc-800 bg-[#100e17] p-2.5 sm:p-3">
              <div className="h-9 rounded-lg bg-indigo-500/15 sm:h-10" />
              <div className="mt-4 h-2 w-10 rounded-full bg-indigo-500/35 sm:w-16" />
              <div className="mt-4 space-y-2">
                <span className="block h-1.5 rounded-full bg-zinc-800" />
                <span className="block h-1.5 rounded-full bg-zinc-800" />
                <span className="block h-1.5 rounded-full bg-zinc-800" />
                <span className="block h-1.5 rounded-full bg-zinc-800" />
              </div>
            </div>

            <div className="min-w-0 p-2.5 sm:p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="h-2.5 w-20 rounded-full bg-zinc-300/80 sm:w-24" />
                <span className="h-6 w-12 rounded-lg border border-zinc-800 bg-zinc-900" />
              </div>

              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                {["Activité", "Membres", "Santé"].map((label) => (
                  <div key={label} className="min-w-0 rounded-lg border border-zinc-800 bg-[#17151f] p-2 sm:p-3">
                    <span className="block truncate text-[8px] text-zinc-600 sm:text-[10px]">{label}</span>
                    <span className="mt-2 block h-2 w-8 rounded-full bg-zinc-700 sm:w-12" />
                  </div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-[1.45fr_0.8fr] gap-1.5 sm:gap-2">
                <div className="min-w-0 rounded-lg border border-zinc-800 bg-[#17151f] p-2 sm:p-3">
                  <span className="text-[8px] text-zinc-600 sm:text-[10px]">Activité récente</span>
                  <svg className="mt-2 h-20 w-full sm:h-24" viewBox="0 0 260 90" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="landing-chart-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#805df5" stopOpacity=".45" />
                        <stop offset="100%" stopColor="#805df5" stopOpacity=".03" />
                      </linearGradient>
                    </defs>
                    <path d="M0 68 C28 42 48 58 72 34 S112 62 145 32 S184 44 208 25 S240 20 260 14 V90 H0Z" fill="url(#landing-chart-fill)" />
                    <path d="M0 68 C28 42 48 58 72 34 S112 62 145 32 S184 44 208 25 S240 20 260 14" fill="none" stroke="#805df5" strokeWidth="3" />
                  </svg>
                </div>
                <div className="min-w-0 rounded-lg border border-zinc-800 bg-[#17151f] p-2 sm:p-3">
                  <span className="text-[8px] text-zinc-600 sm:text-[10px]">État des modules</span>
                  <div className="mx-auto mt-3 aspect-square max-w-20 rounded-full bg-[conic-gradient(#805df5_0_72%,#2c2936_72%)] p-2.5 sm:p-3">
                    <div className="h-full w-full rounded-full bg-[#17151f]" />
                  </div>
                  <span className="mx-auto mt-3 block h-1.5 w-10 rounded-full bg-zinc-700" />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
                <div className="h-10 rounded-lg border border-zinc-800 bg-[#17151f] sm:h-12" />
                <div className="h-10 rounded-lg border border-zinc-800 bg-[#17151f] sm:h-12" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p id="preview-summary" className="sr-only">
        Aperçu illustratif du panel Archodev : navigation latérale, indicateurs sans valeurs réelles, graphique
        d'activité, état des modules et actions rapides.
      </p>
      <p className="mt-2 text-xs text-zinc-500">Interface illustrative — aucune donnée de serveur réelle.</p>
    </section>
  );
}

/* --- 2. Proposition de valeur --- */
export function ValueProp() {
  return (
    <section aria-labelledby="value-title" className="border-y border-zinc-800/60 py-14 text-center">
      <h2 id="value-title" className="mx-auto max-w-3xl font-display text-2xl font-semibold tracking-[-0.01em] text-zinc-100 sm:text-3xl">
        Un panel clair, des résultats concrets.
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
        Archodev réunit modération, animation, statistiques et automatisations au même endroit. Vous activez ce dont
        vous avez besoin, à la carte, et gardez le contrôle de chaque permission.
      </p>
    </section>
  );
}

/* --- 3. Bénéfices --- */
export function Benefits() {
  return (
    <section aria-labelledby="benefits-title" className="border-y border-zinc-800/70 py-10 lg:py-12">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">L'essentiel</div>
          <h2 id="benefits-title" className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-3xl">
            Clarté à chaque étape
          </h2>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-zinc-500">Trois bénéfices concrets, sans détour ni promesse chiffrée.</p>
      </div>
      <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
        {BENEFITS.map((benefit) => {
          const IconComponent = Icon[benefit.icon];
          return (
            <article key={benefit.title} className="rounded-xl border border-zinc-800/90 bg-zinc-900/45 p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300" aria-hidden>
                <IconComponent />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{benefit.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{benefit.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* --- 4. Aperçu des fonctionnalités (registre = source de vérité) --- */
export function FeaturesOverview() {
  return (
    <section aria-labelledby="features-title" className="py-16">
      <div className="text-center">
        <h2 id="features-title" className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Les modules</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-zinc-400">Activés à la carte, sans quitter votre navigateur.</p>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURED_MODULES.map((id) => {
          const module = MODULE_REGISTRY[id];
          const IconComponent = Icon[module.panel.icon as IconName] ?? Icon.bolt;
          return (
            <div key={id} className="rounded-xl border border-zinc-800/90 bg-[linear-gradient(150deg,rgba(29,26,40,0.9),rgba(22,20,31,0.9))] p-5 shadow-(--shadow-card)">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden>
                <IconComponent />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{module.publicName}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{module.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* --- 5. Cas d'usage --- */
export function UseCases() {
  return (
    <section aria-labelledby="usecases-title" className="border-t border-zinc-800/60 py-16">
      <h2 id="usecases-title" className="text-center font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Pensé pour votre communauté</h2>
      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {USE_CASES.map((useCase) => {
          const IconComponent = Icon[useCase.icon];
          return (
            <div key={useCase.title} className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden>
                <IconComponent />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{useCase.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{useCase.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* --- 6. Gestion centralisée --- */
export function Centralized() {
  return (
    <section aria-labelledby="central-title" className="py-16">
      <div className="mx-auto max-w-3xl rounded-2xl border border-indigo-500/40 bg-[linear-gradient(160deg,rgba(107,78,242,0.12),rgba(22,20,31,0.9))] p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200" aria-hidden>
          <Icon.users />
        </span>
        <h2 id="central-title" className="mt-4 font-display text-2xl font-semibold text-zinc-50">Plusieurs serveurs, un seul panel</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-300">
          Gérez jusqu'à trois serveurs avec Premium, cinq avec Business. Retrouvez toutes vos communautés au même
          endroit, avec la même cohérence de configuration — et moins d'erreurs.
        </p>
      </div>
    </section>
  );
}

/* --- 8. Confiance & transparence --- */
export function Trust() {
  return (
    <section aria-labelledby="trust-title" className="border-t border-zinc-800/60 py-16">
      <h2 id="trust-title" className="text-center font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Respectueux de vos données</h2>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-5 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden><Icon.shield /></span>
          <h3 className="mt-4 font-semibold text-zinc-100">Chaque serveur isolé</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">Vos données restent scopées à votre serveur, jamais partagées entre communautés.</p>
        </div>
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-5 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden><Icon.key /></span>
          <h3 className="mt-4 font-semibold text-zinc-100">Permissions minimales</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">Expliquées une par une à l'installation. Aucun accès administrateur global.</p>
        </div>
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-5 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden><Icon.pulse /></span>
          <h3 className="mt-4 font-semibold text-zinc-100">Contrôle à tout moment</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">Désactivez un module quand vous voulez, sans perdre votre configuration.</p>
        </div>
      </div>
    </section>
  );
}

/* --- 9. Dernier appel à l'action --- */
export function FinalCta() {
  return (
    <section aria-labelledby="final-title" className="py-16 text-center">
      <h2 id="final-title" className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Prêt à démarrer&nbsp;?</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
        Ajoutez Archodev à votre serveur et configurez l'essentiel en moins de dix minutes. Gratuit pour commencer.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Button href="/auth/login" variant="primary" size="lg">Se connecter avec Discord</Button>
        <Button href="#offres" variant="secondary" size="lg">Comparer les offres</Button>
      </div>
    </section>
  );
}
