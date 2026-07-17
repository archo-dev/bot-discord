import { Navigate, Route, Routes } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, useEffect } from "react";
import type { MeResponse } from "@bot/shared";
import { api, ApiError } from "./lib/api.js";
import { Landing } from "./pages/Landing.js";
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
const ModLogPage = lazy(() => import("./pages/ModLog.js").then((m) => ({ default: m.ModLogPage })));
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

export function App() {
  const queryClient = useQueryClient();
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
    if (me.error instanceof ApiError && me.error.status === 401) return <Landing />;
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
      <Route path="/guilds/:guildId" element={<GuildLayout me={me.data} />}>
        <Route index element={<Dashboard />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="commands" element={<CommandsPage />} />
        <Route path="commands/new" element={<CommandEditorPage />} />
        <Route path="commands/:commandId" element={<CommandEditorPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="automod" element={<AutomodPage />} />
        <Route path="levels" element={<LevelsPage />} />
        <Route path="starboard" element={<StarboardPage />} />
        <Route path="tempvoice" element={<TempVoicePage />} />
        <Route path="music" element={<MusicPage />} />
        <Route path="modlog" element={<ModLogPage />} />
        <Route path="voicelog" element={<VoiceLogPage />} />
        <Route path="access" element={<PanelAccessPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
