/** Login gate — extracted verbatim from App (M12). */
export function Login() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Archodev Studio</h1>
      <p className="text-sm text-zinc-400">Console d'exploitation réservée aux opérateurs.</p>
      <a
        href="/studio/auth/login"
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
      >
        Se connecter avec Discord
      </a>
    </div>
  );
}
