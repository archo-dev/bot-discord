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

export function LegalPage() {
  const { doc } = useParams<{ doc: string }>();
  const title = doc === "privacy" ? "Confidentialité" : doc === "terms" ? "Conditions d'utilisation" : "Mentions légales";
  return <Stub title={title} lead="Les informations légales seront publiées ici." />;
}
