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
  StudioSubscriptionsListResponse,
  StudioUpdatesListResponse,
} from "@bot/shared";
import { StudioApiError, goToStepUp, studioApi } from "./api.js";

/**
 * Minimal isolated Studio shell (M12). A login gate, a permanent PRODUCTION
 * banner, and four read-first surfaces (overview / guilds / subscriptions /
 * updates). Tabs are hidden when the operator lacks the permission — but this is
 * cosmetic only: the server re-checks every permission (doc 09 principe cardinal).
 */

type Tab = "overview" | "guilds" | "subscriptions" | "updates" | "grants" | "audit" | "metrics" | "errors" | "rollout";

const TAB_PERMISSION: Record<Exclude<Tab, "overview">, StudioPermission> = {
  guilds: "guilds.inspect",
  subscriptions: "subscriptions.read",
  updates: "updates.publish",
  grants: "subscriptions.read",
  audit: "audit.read",
  metrics: "deployments.read",
  errors: "deployments.read",
  rollout: "deployments.read",
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
  const tabs: Tab[] = ["overview", "guilds", "subscriptions", "updates", "grants", "audit", "metrics", "errors", "rollout"];

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

function GrantsPanel({ canGrant, canLifetime, canRevoke }: { canGrant: boolean; canLifetime: boolean; canRevoke: boolean }) {
  const [data, setData] = useState<GrantsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState<GrantablePlan>("premium");
  const [durationKind, setDurationKind] = useState<"7d" | "30d" | "3m" | "6m" | "1y">("30d");
  const [reason, setReason] = useState("");
  const [lifetimeConfirm, setLifetimeConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () =>
    studioApi.grants().then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "error"));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {canGrant && (
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
            <button
              disabled={busy || !userId || reason.trim().length < 3}
              onClick={() => void run(() => studioApi.grant({ userId, planId, durationKind, reason }))}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Octroyer
            </button>
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

      {error && <Err code={error} />}
      {!data ? (
        <Loading />
      ) : (
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
      )}
    </div>
  );
}

function MetricsPanel() {
  const { data, error } = usePanel<StudioMetricsResponse>(() => studioApi.metrics());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
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
  const { data, error } = usePanel<StudioErrorsResponse>(() => studioApi.errors());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
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
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => studioApi.rollout().then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "error"));
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

  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Activation par cohortes (guildes pilotes) — sans redéploiement. Le global reste off en production.</p>
      <Table headers={["Flag", "Global", "Cohorte (guildes)", canEdit ? "" : ""]}>
        {data.flags.map((f) => (
          <tr key={f.flag} className="border-t border-zinc-800">
            <Td>{f.flag}</Td>
            <Td>{f.global ? "on" : "off"}</Td>
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
                    onClick={() => void save(f.flag, f.global, draft[f.flag] ?? f.guilds.join(","))}
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
  const { data, error } = usePanel<StudioAuditPage>(() => studioApi.audit());
  if (error) return <Err code={error} />;
  if (!data) return <Loading />;
  return (
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
  return <div className="text-sm text-zinc-500">Chargement…</div>;
}

function Err({ code }: { code: string }) {
  return <div className="text-sm text-red-400">Erreur : {code}</div>;
}
