import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Button } from "../../ui/kit.js";

/*
 * Pages publiques PLACEHOLDER (M2). Contenu volontairement minimal :
 * la landing commerciale (M3), le pricing (M4) et les notes de mise à jour
 * (M5, page dédiée) apportent le vrai contenu. Aucun prix inventé ici.
 * Chaque page fournit son propre <main> (PublicLayout n'en pose pas).
 */
function Stub({ title, lead, note }: { title: string; lead: string; note?: string }) {
  useEffect(() => {
    document.title = `${title} — Archodev`;
  }, [title]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
      <div className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">Archodev</div>
      <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-4xl">{title}</h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400">{lead}</p>
      <span className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400">
        Bientôt disponible
      </span>
      {note && <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-500">{note}</p>}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button href="/auth/login" variant="secondary" size="md">Se connecter avec Discord</Button>
        <Link to="/" className="text-sm text-indigo-400 hover:underline">Retour à l'accueil</Link>
      </div>
    </main>
  );
}

export function FeaturesPage() {
  return <Stub title="Fonctions" lead="Le détail des capacités du bot, organisé par bénéfice, arrivera ici." />;
}

export function StatusPage() {
  return <Stub title="Statut" lead="L'état des services (Worker, Gateway) sera affiché ici." />;
}

/*
 * Pages juridiques (M16) — BROUILLONS non validés. Le contenu est un point de
 * départ à faire relire/valider juridiquement AVANT toute publication. Un
 * bandeau non masquable le rappelle. Ces pages restent derrière
 * `platform.publicSite` (off en prod) ; elles ne sont donc pas publiées.
 */
const LEGAL_DRAFTS: Record<string, { title: string; sections: { h: string; p: string }[] }> = {
  mentions: {
    title: "Mentions légales",
    sections: [
      { h: "Éditeur", p: "Archodev — [raison sociale, forme juridique, capital, RCS/SIREN à compléter]. Adresse : [à compléter]. Contact : [email à compléter]." },
      { h: "Directeur de la publication", p: "[Nom du responsable à compléter]." },
      { h: "Hébergement", p: "Cloudflare, Inc. (Workers) et VPS OVH (gateway) — coordonnées à compléter." },
      { h: "Propriété intellectuelle", p: "L'ensemble des contenus du service est protégé. Toute reproduction non autorisée est interdite." },
    ],
  },
  privacy: {
    title: "Politique de confidentialité",
    sections: [
      { h: "Données collectées", p: "Identifiants Discord (compte, serveurs administrés), données de configuration du bot, données de facturation fournies par le prestataire de paiement. Aucune donnée n'est vendue." },
      { h: "Finalités", p: "Fournir et sécuriser le service, gérer les abonnements, assurer le support, respecter les obligations légales et comptables." },
      { h: "Conservation (D18 — à valider)", p: "Conservation minimale nécessaire + obligations comptables ; audit et évènements conservés à long terme ; entitlements expirés conservés (historique). Purges via tâche planifiée, jamais manuelles non auditées." },
      { h: "Droits (RGPD)", p: "Accès, rectification, effacement, portabilité, opposition — via [contact à compléter]." },
      { h: "Sous-traitants", p: "Prestataire de paiement (D3 — à confirmer), hébergeurs. Liste détaillée à compléter." },
    ],
  },
  sales: {
    title: "Conditions générales de vente (CGV)",
    sections: [
      { h: "Objet", p: "Les présentes CGV régissent la souscription aux offres payantes (Premium, Business) du service Archodev." },
      { h: "Prix (D1 — à fixer)", p: "Les prix en vigueur sont affichés sur la page Tarifs au moment de la souscription. Aucun prix n'est définitif dans ce brouillon." },
      { h: "Droit de rétractation & remboursement (D12 — à valider)", p: "Droit de rétractation applicable selon le droit de l'Union européenne ; modalités de remboursement à préciser et à faire valider juridiquement." },
      { h: "TVA / facturation (D20 — à valider)", p: "Selon le prestataire retenu (Marchand de Registre gérant la TVA, ou facturation propre + Stripe Tax)." },
      { h: "Résiliation", p: "L'abonnement est résiliable ; l'accès est conservé jusqu'à la fin de la période payée." },
    ],
  },
  terms: {
    title: "Conditions d'utilisation",
    sections: [
      { h: "Acceptation", p: "L'utilisation du service implique l'acceptation des présentes conditions (brouillon à compléter)." },
      { h: "Usage acceptable", p: "Interdiction d'usage abusif, illicite ou portant atteinte à autrui ou au service." },
    ],
  },
};

export function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const draft = LEGAL_DRAFTS[doc ?? "mentions"] ?? LEGAL_DRAFTS.mentions!;
  useEffect(() => {
    document.title = `${draft.title} — Archodev`;
  }, [draft.title]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div
        role="note"
        className="mb-6 rounded-lg border border-red-500/60 bg-red-950/40 px-4 py-3 text-sm font-semibold text-red-200"
      >
        ⚠ BROUILLON — NON VALIDÉ JURIDIQUEMENT. Ne pas publier en l'état ; à faire relire par un avocat.
      </div>
      <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-zinc-50">{draft.title}</h1>
      <div className="mt-8 space-y-6">
        {draft.sections.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold text-zinc-100">{s.h}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.p}</p>
          </section>
        ))}
      </div>
      <div className="mt-10">
        <Link to="/" className="text-sm text-indigo-400 hover:underline">Retour à l'accueil</Link>
      </div>
    </main>
  );
}
