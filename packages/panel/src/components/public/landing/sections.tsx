import { MODULE_REGISTRY } from "@bot/shared";
import { Button } from "../../../ui/kit.js";
import { Icon, type IconName } from "../../../ui/icons.js";
import { BENEFITS, USE_CASES, FEATURED_MODULES } from "./data.js";

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
    <section aria-labelledby="benefits-title" className="py-16">
      <h2 id="benefits-title" className="text-center font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">Ce que vous y gagnez</h2>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((benefit) => {
          const IconComponent = Icon[benefit.icon];
          return (
            <div key={benefit.title} className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300" aria-hidden>
                <IconComponent />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-100">{benefit.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{benefit.description}</p>
            </div>
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
