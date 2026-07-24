import { useEffect, useState } from "react";

export function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-(--z-toast) mx-auto max-w-md rounded-lg border border-amber-800 bg-amber-950 px-4 py-3 text-center text-sm text-amber-200 shadow-lg">
      Connexion interrompue — vos modifications non enregistrées restent affichées. Reconnexion automatique dès le retour du réseau.
    </div>
  );
}
