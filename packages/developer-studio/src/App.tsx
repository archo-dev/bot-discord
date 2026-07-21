import { useEffect, useState } from "react";
import { badgeToneClass } from "@bot/ui";
import type {
  StudioGuildsListResponse,
  StudioOverview,
  StudioPermission,
  StudioSessionInfo,
  StudioSubscriptionsListResponse,
  StudioUpdatesListResponse,
} from "@bot/shared";
import { StudioApiError, studioApi } from "./api.js";

/**
 * Minimal isolated Studio shell (M12). A login gate, a permanent PRODUCTION
 * banner, and four read-first surfaces (overview / guilds / subscriptions /
 * updates). Tabs are hidden when the operator lacks the permission — but this is
 * cosmetic only: the server re-checks every permission (doc 09 principe cardinal).
 */

type Tab = "overview" | "guilds" | "subscriptions" | "updates";

const TAB_PERMISSION: Record<Exclude<Tab, "overview">, StudioPermission> = {
  guilds: "guilds.inspect",
  subscriptions: "subscriptions.read",
  updates: "updates.publish",
};

function ProductionBanner() {
  return (
    <div className="sticky top-0 z-10 bg-red-900/90 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-widest text-red-100">
      ⬤ Environnement PRODUCTION — actions réelles
    </div>
  );
}

function Login() {
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

export function App() {
  const [session, setSession] = useState<StudioSessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    studioApi
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-sm text-zinc-500">Chargement…</div>;
  if (!session) return <Login />;

  const can = (p: StudioPermission) => session.isOwner || session.permissions.includes(p);
  const tabs: Tab[] = ["overview", "guilds", "subscriptions", "updates"];

  return (
    <div className="min-h-screen">
      <ProductionBanner />
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold">Studio</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${badgeToneClass(session.isOwner ? "primary" : "neutral")}`}>
            {session.isOwner ? "Propriétaire" : "Opérateur"}
          </span>
        </div>
        <span className="text-xs text-zinc-500">{session.displayName ?? session.operatorId}</span>
      </header>
      <nav className="flex gap-1 border-b border-zinc-800 px-4">
        {tabs
          .filter((t) => t === "overview" || can(TAB_PERMISSION[t]))
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-indigo-500 text-white" : "text-zinc-400"}`}
            >
              {t}
            </button>
          ))}
      </nav>
      <main className="p-4">
        {tab === "overview" && <OverviewPanel />}
        {tab === "guilds" && can("guilds.inspect") && <GuildsPanel />}
        {tab === "subscriptions" && can("subscriptions.read") && <SubscriptionsPanel />}
        {tab === "updates" && can("updates.publish") && <UpdatesPanel />}
      </main>
    </div>
  );
}

function usePanel<T>(loader: () => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loader()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, error };
}

function OverviewPanel() {
  const { data, error } = usePanel<StudioOverview>(() => studioApi.overview());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Guildes" value={data.guilds} />
      <Kpi label="Entitlements actifs" value={data.activeEntitlements} />
      <Kpi label="Tickets (haute)" value={data.openTickets.high} />
      <Kpi label="Tickets (normale)" value={data.openTickets.normal} />
    </div>
  );
}

function GuildsPanel() {
  const { data, error } = usePanel<StudioGuildsListResponse>(() => studioApi.guilds());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
    <Table headers={["ID", "Nom", "Bot"]}>
      {data.items.map((g) => (
        <tr key={g.id} className="border-t border-zinc-800">
          <Td>{g.id}</Td>
          <Td>{g.name}</Td>
          <Td>{g.botInstalled ? "✓" : "—"}</Td>
        </tr>
      ))}
    </Table>
  );
}

function SubscriptionsPanel() {
  const { data, error } = usePanel<StudioSubscriptionsListResponse>(() => studioApi.subscriptions());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
    <Table headers={["User", "Plan", "Source", "Statut"]}>
      {data.items.map((s) => (
        <tr key={s.id} className="border-t border-zinc-800">
          <Td>{s.userId}</Td>
          <Td>{s.planId}</Td>
          <Td>{s.source}</Td>
          <Td>{s.status}</Td>
        </tr>
      ))}
    </Table>
  );
}

function UpdatesPanel() {
  const [data, setData] = useState<StudioUpdatesListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () =>
    studioApi
      .updates()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "error"));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = async (slug: string) => {
    setBusy(slug);
    try {
      await studioApi.publish(slug);
      await reload();
    } catch (e) {
      setError(e instanceof StudioApiError ? e.code : "error");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
    <Table headers={["Slug", "Titre", "Statut", ""]}>
      {data.items.map((u) => (
        <tr key={u.slug} className="border-t border-zinc-800">
          <Td>{u.slug}</Td>
          <Td>{u.title}</Td>
          <Td>{u.status}</Td>
          <Td>
            {u.status !== "published" && (
              <button
                disabled={busy === u.slug}
                onClick={() => void publish(u.slug)}
                className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Publier
              </button>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-zinc-500">
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1.5 font-mono text-xs text-zinc-300">{children}</td>;
}

function Loading() {
  return <div className="text-sm text-zinc-500">Chargement…</div>;
}

function Err({ code }: { code: string }) {
  return <div className="text-sm text-red-400">Erreur : {code}</div>;
}
