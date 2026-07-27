import { useEffect, useRef, useState } from "react";
import type { StudioPermission, StudioSessionInfo } from "@bot/shared";
import { StudioApiError, studioApi } from "./api.js";
import { AppHeader } from "./components/AppHeader.js";
import { Drawer } from "./components/Drawer.js";
import { Login } from "./components/Login.js";
import { ProductionBanner } from "./components/ProductionBanner.js";
import { Sidebar } from "./components/Sidebar.js";
import { NAV_SECTIONS, TAB_PERMISSION, type NavSection, type Tab } from "./lib/nav.js";
import { AuditPanel } from "./panels/AuditPanel.js";
import { ErrorsPanel } from "./panels/ErrorsPanel.js";
import { GrantsPanel } from "./panels/GrantsPanel.js";
import { GuildsPanel } from "./panels/GuildsPanel.js";
import { MetricsPanel } from "./panels/MetricsPanel.js";
import { OverviewPanel } from "./panels/OverviewPanel.js";
import { RolloutPanel } from "./panels/RolloutPanel.js";
import { SubscriptionsPanel } from "./panels/SubscriptionsPanel.js";
import { SupportPanel } from "./panels/SupportPanel.js";
import { UpdatesPanel } from "./panels/UpdatesPanel.js";
import { UsersPanel } from "./panels/UsersPanel.js";
import { ErrorState } from "./ui/index.js";

/**
 * Minimal isolated Studio shell (M12). A login gate, a permanent PRODUCTION
 * banner, and read-first surfaces. Tabs are hidden when the operator lacks the
 * permission — but this is cosmetic only: the server re-checks every permission
 * (doc 09 principe cardinal).
 *
 * Lot 1 (refonte UX) : le shell orchestre ; bannière, header, nav, hook de
 * chargement, primitives UI et panels sont extraits en modules dédiés.
 *
 * Lot 2 (navigation) : la barre d'onglets horizontale devient une sidebar
 * groupée (desktop) + un drawer latéral (mobile). Les routes, panels et le
 * gating can(...) sont strictement inchangés.
 */
export function App() {
  const [session, setSession] = useState<StudioSessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportCount, setSupportCount] = useState<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerActiveRef = useRef<HTMLButtonElement | null>(null);

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

  // Best-effort Support counter for the sidebar badge: reuses the existing
  // /studio-api/overview GET (no new endpoint/contract). No data → no badge.
  useEffect(() => {
    if (!session) return;
    const canSupport = session.isOwner || session.permissions.includes("support.manage");
    if (!canSupport) return;
    let active = true;
    studioApi
      .overview()
      .then((o) => {
        if (active) setSupportCount(o.openTickets.high + o.openTickets.normal + o.openTickets.low);
      })
      .catch(() => {
        /* badge is optional; leave it absent on failure */
      });
    return () => {
      active = false;
    };
  }, [session]);

  if (loading) return <div className="p-8 text-sm text-zinc-500" aria-busy="true">Chargement…</div>;
  if (sessionError) return <div className="p-8"><ErrorState code={sessionError} onRetry={loadSession} /></div>;
  if (!session) return <Login />;

  const can = (p: StudioPermission) => session.isOwner || session.permissions.includes(p);
  // Same membership as before (overview always; others gated by TAB_PERMISSION);
  // NAV_SECTIONS only adds display order, grouping, icons.
  const sections: NavSection[] = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.id === "overview" || can(TAB_PERMISSION[item.id])),
  })).filter((section) => section.items.length > 0);
  const selectTab = (next: Tab) => {
    setTab(next);
    setMenuOpen(false);
  };
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
    <div className="flex h-screen flex-col overflow-hidden">
      <ProductionBanner />
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 lg:block">
          <Sidebar
            sections={sections}
            current={tab}
            onSelect={selectTab}
            session={session}
            supportCount={supportCount}
          />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            session={session}
            loggingOut={loggingOut}
            onLogout={() => void logout()}
            onOpenMenu={() => setMenuOpen(true)}
            menuButtonRef={menuButtonRef}
          />
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4">
            {tab === "overview" && <OverviewPanel can={can} onNavigate={selectTab} />}
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
      </div>

      {/* Mobile drawer */}
      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        returnFocusRef={menuButtonRef}
        focusRef={drawerActiveRef}
      >
        <Sidebar
          sections={sections}
          current={tab}
          onSelect={selectTab}
          session={session}
          supportCount={supportCount}
          itemRef={(el) => {
            drawerActiveRef.current = el;
          }}
        />
      </Drawer>
    </div>
  );
}
