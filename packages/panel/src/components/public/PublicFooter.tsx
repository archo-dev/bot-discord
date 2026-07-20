import { Link } from "react-router";

/* Pied de page public (M2), sobre. Liens minimaux ; contenu enrichi en M3+. */
export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-800/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>Archodev · Panel Discord Nocturne</span>
        <nav aria-label="Liens de pied de page" className="flex flex-wrap gap-4">
          <Link to="/status" className="transition hover:text-zinc-300">Statut</Link>
          <Link to="/legal/mentions" className="transition hover:text-zinc-300">Mentions légales</Link>
          <Link to="/legal/privacy" className="transition hover:text-zinc-300">Confidentialité</Link>
        </nav>
      </div>
    </footer>
  );
}
