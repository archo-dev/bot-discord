import { Button } from "../ui/kit.js";
import { Wordmark } from "../ui/brand.js";
import { LandingContent } from "./LandingContent.js";

/*
 * Vitrine autonome — surface publique historique, rendue quand `/api/me`
 * renvoie 401 (utilisateur déconnecté) et que le shell public est OFF.
 * Le corps (hero + modules + réassurance) vit dans LandingContent (M2),
 * partagé avec la home publique. Chrome (glow + header + footer) inchangé.
 */
export function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-3xl" aria-hidden />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Wordmark size={30} textClassName="text-[18px]" />
        <Button href="/auth/login" variant="secondary" size="sm">Ouvrir le panel</Button>
      </header>

      <LandingContent />

      <footer className="relative mx-auto max-w-6xl px-4 py-8 text-center text-xs text-zinc-600 sm:px-6">
        Archodev · Panel Discord Nocturne
      </footer>
    </div>
  );
}
