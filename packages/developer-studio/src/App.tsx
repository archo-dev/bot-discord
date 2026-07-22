import { useEffect, useState } from "react";
import { badgeToneClass } from "@bot/ui";
import type {
  GrantablePlan,
  GrantsListResponse,
  RolloutResponse,
  StudioAuditPage,
  StudioErrorsResponse,
  StudioGuildsListResponse,
  StudioMetricsResponse,
  StudioOverview,
  StudioPermission,
  StudioSessionInfo,
  StudioSupportListResponse,
  StudioSubscriptionsListResponse,
  StudioUpdatesListResponse,
  StudioUsersListResponse,
} from "@bot/shared";
import { StudioApiError, goToStepUp, studioApi } from "./api.js";

/**
 * Minimal isolated Studio shell (M12). A login gate, a permanent PRODUCTION
 * banner, and four read-first surfaces (overview / guilds / subscriptions /
 * updates). Tabs are hidden when the operator lacks the permission — but this is
 * cosmetic only: the server re-checks every permission (doc 09 principe cardinal).
 */

type Tab = "overview" | "users" | "guilds" | "subscriptions" | "support" | "updates" | "grants" | "audit" | "metrics" | "errors" | "rollout";

const TAB_PERMISSION: Record<Exclude<Tab, "overview">, StudioPermission> = {
  users: "guilds.inspect",
  guilds: "guilds.inspect",
  subscriptions: "subscriptions.read",
  support: "support.manage",
  updates: "updates.publish",
  grants: "subscriptions.read",
  audit: "audit.read",
  metrics: "deployments.read",
  errors: "deployments.read",
  rollout: "deployments.read",
};

function ProductionBanner() {
  const isStaging = import.meta.env.MODE === "staging";
  return (
    <div className="sticky top-0 z-10 bg-red-900/90 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-widest text-red-100">
      {isStaging ? "⬤ Environnement STAGING — actions de test" : "⬤ Environnement PRODUCTION — actions réelles"}
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
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const loadSession = () => {
    setLoading(true);
    setSessionError(null);
    studioApi
      .session()
      .then(setSession)
      .catch((error: unknown) => {
        setSession(null);
        if (!(error instanceof StudioApiError) || error.status !== 401) {
          setSessionError(error instanceof StudioApiError ? error.code : "network_error");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const expireSession = () => {
      setSession(null);
      setSessionError(null);
      setLoading(false);
    };
    window.addEventListener("studio:session-expired", expireSession);
    loadSession();
    // Chargement initial uniquement ; les reprises passent par le bouton retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => window.removeEventListener("studio:session-expired", expireSession);
  }, []);

  if (loading) return <div className="p-8 text-sm text-zinc-500" aria-busy="true">Chargement…</div>;
  if (sessionError) return <div className="p-8"><Err code={sessionError} onRetry={loadSession} /></div>;
  if (!session) return <Login />;

  const can = (p: StudioPermission) => session.isOwner || session.permissions.includes(p);
  const tabs: Tab[] = ["overview", "users", "guilds", "subscriptions", "support", "updates", "grants", "audit", "metrics", "errors", "rollout"];
  const logout = async () => {
    setLoggingOut(true);
    setSessionError(null);
    try {
      await studioApi.logout();
      setSession(null);
    } catch (error) {
      setSessionError(error instanceof StudioApiError ? error.code : "network_error");
    } finally {
      setLoggingOut(false);
    }
  };

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
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:inline">{session.displayName ?? session.operatorId}</span>
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => void logout()}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-50"
          >
            {loggingOut ? "Déconnexion…" : "Déconnexion"}
          </button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-4" aria-label="Sections du Studio">
        {tabs
          .filter((t) => t === "overview" || can(TAB_PERMISSION[t]))
          .map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
              className={`shrink-0 px-3 py-2 text-sm ${tab === t ? "border-b-2 border-indigo-500 text-white" : "text-zinc-400"}`}
            >
              {t}
            </button>
          ))}
      </nav>
      <main className="p-4">
        {tab === "overview" && <OverviewPanel />}
        {tab === "users" && can("guilds.inspect") && <UsersPanel />}
        {tab === "guilds" && can("guilds.inspect") && <GuildsPanel />}
        {tab === "subscriptions" && can("subscriptions.read") && <SubscriptionsPanel />}
        {tab === "support" && can("support.manage") && <SupportPanel />}
        {tab === "updates" && can("updates.publish") && <UpdatesPanel />}
        {tab === "grants" && can("subscriptions.read") && (
          <GrantsPanel canGrant={can("subscriptions.grant")} canLifetime={can("subscriptions.grant_lifetime")} canRevoke={can("subscriptions.revoke_granted")} />
        )}
        {tab === "audit" && can("audit.read") && <AuditPanel />}
        {tab === "metrics" && can("deployments.read") && <MetricsPanel />}
        {tab === "errors" && can("deployments.read") && <ErrorsPanel />}
        {tab === "rollout" && can("deployments.read") && <RolloutPanel canEdit={can("features.manage")} />}
      </main>
    </div>
  );
}

function usePanel<T>(loader: () => Promise<T>, reloadKey: unknown = null): { data: T | null; error: string | null; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    loader()
      .then((value) => { if (active) setData(value); })
      .catch((e: unknown) => { if (active) setError(e instanceof StudioApiError ? e.code : "network_error"); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, reloadKey]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}

function OverviewPanel() {
  const { data, error, retry } = usePanel<StudioOverview>(() => studioApi.overview());
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi label="Guildes" value={data.guilds} />
      <Kpi label="Entitlements actifs" value={data.activeEntitlements} />
      <Kpi label="Tickets (haute)" value={data.openTickets.high} />
      <Kpi label="Tickets (normale)" value={data.openTickets.normal} />
      <Kpi label="Tickets (basse)" value={data.openTickets.low} />
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="truncate text-sm font-semibold">{data.latestUpdate?.title ?? "Aucune"}</div>
        <div className="mt-1 text-xs text-zinc-500">Dernière mise à jour publiée</div>
      </div>
    </div>
  );
}

function UsersPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioUsersListResponse>(() => studioApi.users(page), page);
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucun utilisateur connu." />;
  return (
    <>
      <Table headers={["User ID", "Entitlements actifs", "Tickets support", "Dernière activité"]}>
        {data.items.map((user) => (
          <tr key={user.userId} className="border-t border-zinc-800">
            <Td>{user.userId}</Td>
            <Td>{user.activeEntitlements}</Td>
            <Td>{user.supportTickets}</Td>
            <Td>{user.lastActivityAt}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function GuildsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioGuildsListResponse>(() => studioApi.guilds(page), page);
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucune guilde enregistrée." />;
  return (
    <>
      <Table headers={["ID", "Nom", "Bot"]}>
        {data.items.map((g) => (
          <tr key={g.id} className="border-t border-zinc-800">
            <Td>{g.id}</Td>
            <Td>{g.name}</Td>
            <Td>{g.botInstalled ? "✓" : "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function SubscriptionsPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioSubscriptionsListResponse>(() => studioApi.subscriptions(page), page);
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucun abonnement enregistré." />;
  return (
    <>
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
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function SupportPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioSupportListResponse>(() => studioApi.support(page), page);
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucun ticket support." />;
  return (
    <>
      <Table headers={["Priorité", "Ticket", "Utilisateur", "Guilde", "Plan", "Statut", "Assigné", "Créé"]}>
        {data.items.map((ticket) => (
          <tr key={ticket.id} className="border-t border-zinc-800">
            <Td>{ticket.priority}</Td>
            <Td>#{ticket.id} · {ticket.subject}</Td>
            <Td>{ticket.userId}</Td>
            <Td>{ticket.guildId ?? "—"}</Td>
            <Td>{ticket.planAtOpen}</Td>
            <Td>{ticket.status}</Td>
            <Td>{ticket.assignee ?? "—"}</Td>
            <Td>{ticket.createdAt}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function UpdatesPanel() {
  const [data, setData] = useState<StudioUpdatesListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const reload = () => {
    setError(null);
    return studioApi
      .updates(page)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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

  if (error) return <Err code={error} onRetry={() => void reload()} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucune note de mise à jour." />;
  return (
    <>
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
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function GrantsPanel({ canGrant, canLifetime, canRevoke }: { canGrant: boolean; canLifetime: boolean; canRevoke: boolean }) {
  const [data, setData] = useState<GrantsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState<GrantablePlan>("premium");
  const [durationKind, setDurationKind] = useState<"7d" | "30d" | "3m" | "6m" | "1y">("30d");
  const [reason, setReason] = useState("");
  const [lifetimeConfirm, setLifetimeConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const reload = () => {
    setError(null);
    return studioApi.grants(page).then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const [needStepUp, setNeedStepUp] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNeedStepUp(false);
    try {
      await fn();
      await reload();
    } catch (e) {
      const code = e instanceof StudioApiError ? e.code : "error";
      // M14: a lifetime grant needs a fresh OAuth re-consent (step-up).
      if (code === "step_up_required") setNeedStepUp(true);
      setError(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {(canGrant || canLifetime) && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-3 text-sm font-semibold">Octroyer un accès offert</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="User ID">
              <input value={userId} onChange={(e) => setUserId(e.target.value)} className="w-48 rounded bg-zinc-800 px-2 py-1 text-sm" placeholder="snowflake" />
            </Field>
            <Field label="Plan">
              <select value={planId} onChange={(e) => setPlanId(e.target.value as GrantablePlan)} className="rounded bg-zinc-800 px-2 py-1 text-sm">
                <option value="premium">premium</option>
                <option value="business">business</option>
              </select>
            </Field>
            <Field label="Durée">
              <select value={durationKind} onChange={(e) => setDurationKind(e.target.value as typeof durationKind)} className="rounded bg-zinc-800 px-2 py-1 text-sm">
                {(["7d", "30d", "3m", "6m", "1y"] as const).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Raison">
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-64 rounded bg-zinc-800 px-2 py-1 text-sm" placeholder="obligatoire" />
            </Field>
            {canGrant && (
              <button
                disabled={busy || !userId || reason.trim().length < 3}
                onClick={() => void run(() => studioApi.grant({ userId, planId, durationKind, reason }))}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Octroyer
              </button>
            )}
          </div>

          {canLifetime && (
            <div className="mt-4 rounded border border-red-900/60 bg-red-950/30 p-3">
              <p className="mb-2 text-xs text-red-300">
                Lifetime — engagement permanent. Saisir <b>LIFETIME</b> pour confirmer.
              </p>
              {needStepUp && (
                <p className="mb-2 text-xs text-amber-300">
                  Ré-authentification requise —{" "}
                  <button onClick={goToStepUp} className="underline">Ré-authentifier</button>
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Confirmation">
                  <input value={lifetimeConfirm} onChange={(e) => setLifetimeConfirm(e.target.value)} className="w-40 rounded bg-zinc-800 px-2 py-1 text-sm" placeholder="LIFETIME" />
                </Field>
                <button
                  disabled={busy || !userId || reason.trim().length < 3 || lifetimeConfirm !== "LIFETIME"}
                  onClick={() => void run(() => studioApi.grantLifetime({ userId, planId, reason, confirm: lifetimeConfirm }))}
                  className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Octroyer à vie
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {error && data && <Err code={error} onRetry={() => void reload()} />}
      {!data && error ? (
        <Err code={error} onRetry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Empty label="Aucun accès offert." />
      ) : (
        <>
          <Table headers={["User", "Plan", "Durée", "Statut", "Raison", ""]}>
            {data.items.map((g) => (
              <tr key={g.grantId} className="border-t border-zinc-800">
                <Td>{g.userId}</Td>
                <Td>{g.planId}</Td>
                <Td>{g.isLifetime ? "lifetime" : g.durationKind}</Td>
                <Td>{g.status}</Td>
                <Td>{g.reason}</Td>
                <Td>
                  {canRevoke && g.status === "active" && (
                    <button
                      disabled={busy}
                      onClick={() => window.confirm("Révoquer cet accès offert ?") && void run(() => studioApi.revoke(g.entitlementId))}
                      className="rounded bg-zinc-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Révoquer
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function MetricsPanel() {
  const { data, error, retry } = usePanel<StudioMetricsResponse>(() => studioApi.metrics());
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.modules.length === 0) return <Empty label="Aucune métrique agrégée sur la période." />;
  return (
    <div className="space-y-3">
      <div className="text-xs text-zinc-500">
        Fenêtre {data.windowHours} h — {data.totalEvents} évènements, {data.totalErrors} erreurs
      </div>
      <Table headers={["Module", "Events", "Erreurs", "Taux", "≤500ms", ">5s"]}>
        {data.modules.map((m) => (
          <tr key={m.module} className="border-t border-zinc-800">
            <Td>{m.module}</Td>
            <Td>{m.events}</Td>
            <Td>{m.errors}</Td>
            <Td>{(m.errorRate * 100).toFixed(1)}%</Td>
            <Td>{m.latencyLe100 + m.latencyLe250 + m.latencyLe500}</Td>
            <Td>{m.latencyGt5000}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ErrorsPanel() {
  const { data, error, retry } = usePanel<StudioErrorsResponse>(() => studioApi.errors());
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucune erreur agrégée sur la période." />;
  return (
    <Table headers={["Module", "Opération", "Erreurs", "Events"]}>
      {data.items.map((e) => (
        <tr key={`${e.module}:${e.operation}`} className="border-t border-zinc-800">
          <Td>{e.module}</Td>
          <Td>{e.operation}</Td>
          <Td>{e.errors}</Td>
          <Td>{e.events}</Td>
        </tr>
      ))}
    </Table>
  );
}

function RolloutPanel({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<RolloutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [globalDraft, setGlobalDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    return studioApi.rollout().then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (flag: string, global: boolean, guildsCsv: string) => {
    setBusy(flag);
    setError(null);
    try {
      const guilds = guildsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      await studioApi.setRollout(flag, { global, guilds });
      await reload();
    } catch (e) {
      setError(e instanceof StudioApiError ? e.code : "error");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Err code={error} onRetry={() => void reload()} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Activation par cohortes (guildes pilotes) — sans redéploiement. Le global reste off en production.</p>
      <Table headers={["Flag", "Global", "Cohorte (guildes)", canEdit ? "" : ""]}>
        {data.flags.map((f) => (
          <tr key={f.flag} className="border-t border-zinc-800">
            <Td>{f.flag}</Td>
            <Td>
              {canEdit ? (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={globalDraft[f.flag] ?? f.global}
                    onChange={(event) => setGlobalDraft((current) => ({ ...current, [f.flag]: event.target.checked }))}
                  />
                  {globalDraft[f.flag] ?? f.global ? "on" : "off"}
                </label>
              ) : f.global ? "on" : "off"}
            </Td>
            <Td>{f.guilds.length ? f.guilds.join(", ") : "—"}</Td>
            <Td>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <input
                    defaultValue={f.guilds.join(",")}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.flag]: e.target.value }))}
                    placeholder="ids,séparés,par,virgule"
                    className="w-56 rounded bg-zinc-800 px-2 py-1 text-xs"
                  />
                  <button
                    disabled={busy === f.flag}
                    onClick={() => void save(f.flag, globalDraft[f.flag] ?? f.global, draft[f.flag] ?? f.guilds.join(","))}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function AuditPanel() {
  const [page, setPage] = useState(1);
  const { data, error, retry } = usePanel<StudioAuditPage>(() => studioApi.audit(page), page);
  if (error) return <Err code={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (data.items.length === 0) return <Empty label="Aucun événement d’audit." />;
  return (
    <>
      <Table headers={["Date", "Acteur", "Action", "Cible"]}>
        {data.items.map((ev) => (
          <tr key={ev.id} className="border-t border-zinc-800">
            <Td>{ev.createdAt}</Td>
            <Td>{ev.actor}</Td>
            <Td>{ev.action}</Td>
            <Td>{ev.targetType ? `${ev.targetType}:${ev.targetId ?? "—"}` : "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      {children}
    </label>
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
  return <div className="text-sm text-zinc-500" aria-busy="true">Chargement…</div>;
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
      <span>Page {page} sur {totalPages} · {total} résultats</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40">Précédent</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40">Suivant</button>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">{label}</div>;
}

function Err({ code, onRetry }: { code: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-400">
      <span>Erreur : {code}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded border border-red-800 px-2 py-1 text-xs text-red-200">
          Réessayer
        </button>
      )}
    </div>
  );
}
