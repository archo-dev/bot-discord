import { Navigate, Route, Routes, useLocation } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import type { MeResponse } from "@bot/shared";
import { api, ApiError } from "./lib/api.js";
import { getPlatformFlags } from "./lib/flags.js";
import { isPublicPath, shouldRenderPublicHome } from "./lib/public-routes.js";
import { Landing } from "./pages/Landing.js";
import { LandingContent } from "./pages/LandingContent.js";
import { GuildList } from "./pages/GuildList.js";
import { GuildLayout } from "./pages/GuildLayout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ErrorCard } from "./ui/kit.js";
import { Skeleton, SkeletonGuildGrid } from "./ui/skeleton.js";

/*
 * Découpage de code (M04) — chaque page secondaire vit dans son propre chunk,
 * chargé à la navigation. Le shell (GuildList, GuildLayout, Dashboard, Login)
 * reste dans le chunk initial : c'est le parcours d'atterrissage le plus
 * probable, il ne doit jamais suspendre. Les modules exportent des composants
 * nommés → on les réexporte en `default` pour `React.lazy`.
 * Recharts (~lourd) n'est importé que par Stats : il part donc avec ce chunk.
 * Le <Suspense> qui couvre ces routes vit dans GuildLayout (autour de l'Outlet),
 * pour que la nav et l'en-tête restent affichés pendant le chargement.
 */
const ConfigPage = lazy(() => import("./pages/Config.js").then((m) => ({ default: m.ConfigPage })));
const CommandsPage = lazy(() => import("./pages/Commands.js").then((m) => ({ default: m.CommandsPage })));
const CommandEditorPage = lazy(() => import("./pages/CommandEditor.js").then((m) => ({ default: m.CommandEditorPage })));
const AutomationsPage = lazy(() => import("./pages/Automations.js").then((m) => ({ default: m.AutomationsPage })));
const AutomationEditorPage = lazy(() => import("./pages/AutomationEditor.js").then((m) => ({ default: m.AutomationEditorPage })));
const ModerationHistoryPage = lazy(() => import("./pages/Sanctions.js").then((m) => ({ default: m.ModerationHistoryPage })));
const ApplySanctionPage = lazy(() => import("./pages/Sanctions.js").then((m) => ({ default: m.ApplySanctionPage })));
const VoiceLogPage = lazy(() => import("./pages/VoiceLog.js").then((m) => ({ default: m.VoiceLogPage })));
const StatsPage = lazy(() => import("./pages/Stats.js").then((m) => ({ default: m.StatsPage })));
const PanelAccessPage = lazy(() => import("./pages/PanelAccess.js").then((m) => ({ default: m.PanelAccessPage })));
const TicketsPage = lazy(() => import("./pages/Tickets.js").then((m) => ({ default: m.TicketsPage })));
const RolesPage = lazy(() => import("./pages/Roles.js").then((m) => ({ default: m.RolesPage })));
const WelcomePage = lazy(() => import("./pages/Welcome.js").then((m) => ({ default: m.WelcomePage })));
const AutomodPage = lazy(() => import("./pages/Automod.js").then((m) => ({ default: m.AutomodPage })));
const LevelsPage = lazy(() => import("./pages/Levels.js").then((m) => ({ default: m.LevelsPage })));
const StarboardPage = lazy(() => import("./pages/Starboard.js").then((m) => ({ default: m.StarboardPage })));
const TempVoicePage = lazy(() => import("./pages/TempVoice.js").then((m) => ({ default: m.TempVoicePage })));
const MusicPage = lazy(() => import("./pages/Music.js").then((m) => ({ default: m.MusicPage })));
const HealthPage = lazy(() => import("./pages/Health.js").then((m) => ({ default: m.HealthPage })));
const AuditPage = lazy(() => import("./pages/Audit.js").then((m) => ({ default: m.AuditPage })));
const ModulesPage = lazy(() => import("./pages/Modules.js").then((m) => ({ default: m.ModulesPage })));
const OnboardingPage = lazy(() => import("./pages/Onboarding.js").then((m) => ({ default: m.OnboardingPage })));
const BackupPage = lazy(() => import("./pages/Backup.js").then((m) => ({ default: m.BackupPage })));
const PrivacyPage = lazy(() => import("./pages/Privacy.js").then((m) => ({ default: m.PrivacyPage })));

/* Espace client (M8) — chargé à la demande, uniquement quand le flag
   `platform.entitlements` est ON. Absent du chunk initial. */
const AppLayout = lazy(() => import("./layouts/AppLayout.js").then((m) => ({ default: m.AppLayout })));
const SubscriptionPage = lazy(() => import("./pages/app/Subscription.js").then((m) => ({ default: m.SubscriptionPage })));
const AccountPage = lazy(() => import("./pages/app/Account.js").then((m) => ({ default: m.AccountPage })));
const BillingPage = lazy(() => import("./pages/app/Billing.js").then((m) => ({ default: m.BillingPage })));
const SupportPage = lazy(() => import("./pages/app/Support.js").then((m) => ({ default: m.SupportPage })));

/* Shell public (M2) — chargé à la demande, uniquement quand le flag
   `platform.publicSite` est ON. Absent du chunk initial. */
const PublicLayout = lazy(() => import("./layouts/PublicLayout.js").then((m) => ({ default: m.PublicLayout })));
const FeaturesPage = lazy(() => import("./pages/public/PublicStubs.js").then((m) => ({ default: m.FeaturesPage })));
const PricingPage = lazy(() => import("./pages/public/Pricing.js").then((m) => ({ default: m.PricingPage })));
const UpdatesPage = lazy(() => import("./pages/public/Updates.js").then((m) => ({ default: m.UpdatesPage })));
const UpdateDetailPage = lazy(() => import("./pages/public/UpdateDetail.js").then((m) => ({ default: m.UpdateDetailPage })));
const StatusPage = lazy(() => import("./pages/public/PublicStubs.js").then((m) => ({ default: m.StatusPage })));
const LegalPage = lazy(() => import("./pages/public/PublicStubs.js").then((m) => ({ default: m.LegalPage })));

function PublicFallback() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <div className="mt-8">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const flags = getPlatformFlags();
  const publicSite = flags["platform.publicSite"];
  const entitlements = flags["platform.entitlements"];
  useEffect(() => {
    const refreshSession = () => void queryClient.invalidateQueries({ queryKey: ["me"], exact: true });
    window.addEventListener("panel:session-expired", refreshSession);
    return () => window.removeEventListener("panel:session-expired", refreshSession);
  }, [queryClient]);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    retry: false,
  });

  // Shell public (M2) : les chemins publics dédiés ne dépendent pas de la
  // session → court-circuit AVANT la gate ["me"]. Actif uniquement flag ON ;
  // flag OFF ⇒ condition morte, comportement identique à l'existant.
  if (publicSite && isPublicPath(location.pathname)) {
    return (
      <Suspense fallback={<PublicFallback />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/features" element={<FeaturesPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/updates/:slug" element={<UpdateDetailPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/legal" element={<Navigate to="/legal/mentions" replace />} />
            <Route path="/legal/:doc" element={<LegalPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // Home public : ne bloque JAMAIS le rendu public sur /api/me. Avec le site
  // public actif, la racine rend la vitrine tant que le visiteur n'est pas
  // authentifié (l'en-tête reflète l'état de connexion quand ["me"] résout ; un
  // visiteur connecté bascule vers son tableau de bord au succès). Empêche un
  // écran de chargement infini si /api/me est lent, injoignable ou en échec.
  if (shouldRenderPublicHome(location.pathname, { publicSite, authenticated: me.isSuccess })) {
    return (
      <Suspense fallback={<PublicFallback />}>
        <PublicLayout>
          <LandingContent />
        </PublicLayout>
      </Suspense>
    );
  }

  if (me.isPending) {
    // Squelette de la destination la plus probable (liste des serveurs) — zéro layout shift
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10" aria-busy="true">
        <div className="mb-8 flex items-center justify-between">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <SkeletonGuildGrid />
      </div>
    );
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      // Flag ON : la racine déconnectée devient la home publique (même chrome
      // que les autres pages publiques). Flag OFF : Landing autonome (inchangé).
      if (publicSite && location.pathname === "/") {
        return (
          <Suspense fallback={<PublicFallback />}>
            <PublicLayout>
              <LandingContent />
            </PublicLayout>
          </Suspense>
        );
      }
      return <Landing />;
    }
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
        <div className="w-full">
          <ErrorCard
            message="Erreur de connexion au serveur — réessayez plus tard."
            onRetry={() => void me.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<GuildList me={me.data} />} />
      {/* Espace client (M8) — gardé par platform.entitlements ; sinon catch-all → "/". */}
      {entitlements && (
        <Route path="/app" element={<Suspense fallback={<PublicFallback />}><AppLayout /></Suspense>}>
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="account" element={<AccountPage />} />
          {/* Facturation (M9) — flag additionnel platform.billing. */}
          {flags["platform.billing"] && <Route path="billing" element={<BillingPage />} />}
          {/* Support (M11) — flag additionnel platform.support. */}
          {flags["platform.support"] && <Route path="support" element={<SupportPage />} />}
        </Route>
      )}
      <Route path="/guilds/:guildId" element={<GuildLayout me={me.data} />}>
        <Route index element={<Dashboard />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="commands" element={<CommandsPage />} />
        <Route path="commands/new" element={<CommandEditorPage />} />
        <Route path="commands/:commandId" element={<CommandEditorPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/new" element={<AutomationEditorPage />} />
        <Route path="automations/:automationId" element={<AutomationEditorPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="automod" element={<AutomodPage />} />
        <Route path="levels" element={<LevelsPage />} />
        <Route path="starboard" element={<StarboardPage />} />
        <Route path="tempvoice" element={<TempVoicePage />} />
        <Route path="music" element={<MusicPage />} />
        {/* Legacy Mod-log route folded into the unified history (keeps old links alive). */}
        <Route path="modlog" element={<Navigate to="../sanctions" replace />} />
        <Route path="sanctions" element={<ModerationHistoryPage />} />
        <Route path="apply" element={<ApplySanctionPage />} />
        <Route path="voicelog" element={<VoiceLogPage />} />
        <Route path="access" element={<PanelAccessPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
