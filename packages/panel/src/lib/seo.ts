import { useEffect } from "react";

/*
 * SEO client minimal (M3) : pose document.title + <meta name="description">
 * le temps du montage, et restaure l'état précédent au démontage.
 * Suffisant pour une SPA ; pas de SSR/pré-rendu ici.
 */
export function useDocumentMeta({ title, description }: { title: string; description?: string }): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    let meta: HTMLMetaElement | null = null;
    let createdMeta = false;
    let previousDescription: string | null = null;

    if (description) {
      meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (meta) {
        previousDescription = meta.getAttribute("content");
      } else {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
        createdMeta = true;
      }
      meta.setAttribute("content", description);
    }

    return () => {
      document.title = previousTitle;
      if (!meta) return;
      if (createdMeta) meta.remove();
      else if (previousDescription !== null) meta.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}
