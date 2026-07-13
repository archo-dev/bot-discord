import { Component, type ReactNode } from "react";
import { ErrorCard } from "./kit.js";

/*
 * Filet de sécurité du code-splitting (M04). Avec React.lazy, l'échec de
 * chargement d'un chunk (réseau transitoire, ou surtout un index.html périmé
 * demandant un hash supprimé par un redéploiement — servi en 404 par le worker)
 * rejette pendant le rendu. Sans ce boundary, l'erreur remonte à la racine et
 * casse tout l'écran. Ici :
 *  - erreur de chargement de chunk → un SEUL rechargement automatique (garde
 *    anti-boucle en sessionStorage) pour récupérer un index.html à jour ;
 *  - si le rechargement ne résout pas (réseau réellement coupé) ou pour toute
 *    autre erreur de rendu → carte d'erreur Nocturne avec rechargement manuel.
 * L'état se réinitialise à chaque navigation car le parent monte ce boundary
 * sous une clé de route (`key={location.pathname}` dans GuildLayout).
 */

const RELOAD_GUARD_KEY = "panel:chunk-reload-at";
const RELOAD_GUARD_MS = 10_000;

/** Vrai si l'erreur ressemble à un échec de chargement de module dynamique. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`;
  return /chunkloaderror|dynamically imported module|importing a module script failed|failed to fetch dynamically|error loading|module script/i.test(
    text,
  );
}

/** Recharge une seule fois par fenêtre de garde ; renvoie false si déjà tenté (boucle). */
function tryReloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
    if (Date.now() - last < RELOAD_GUARD_MS) return false; // déjà rechargé récemment
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponible (mode privé strict) : ne pas boucler.
    return false;
  }
  window.location.reload();
  return true;
}

interface State {
  failed: boolean;
}

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Cas le plus courant après un redéploiement : recharger pour obtenir un
    // index.html avec les hashes courants. Une seule fois (garde anti-boucle).
    if (isChunkLoadError(error) && tryReloadOnce()) return;
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <ErrorCard
          message="Impossible de charger cette page. Rechargez le panel pour récupérer la dernière version."
          onRetry={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
