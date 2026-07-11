import { Navigate, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MeResponse } from "@bot/shared";
import { api, ApiError } from "./lib/api.js";
import { Login } from "./pages/Login.js";
import { GuildList } from "./pages/GuildList.js";
import { GuildLayout } from "./pages/GuildLayout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ConfigPage } from "./pages/Config.js";
import { CommandsPage } from "./pages/Commands.js";
import { CommandEditorPage } from "./pages/CommandEditor.js";
import { ModLogPage } from "./pages/ModLog.js";
import { PanelAccessPage } from "./pages/PanelAccess.js";
import { TicketsPage } from "./pages/Tickets.js";
import { RolesPage } from "./pages/Roles.js";
import { WelcomePage } from "./pages/Welcome.js";
import { AutomodPage } from "./pages/Automod.js";
import { LevelsPage } from "./pages/Levels.js";
import { MusicPage } from "./pages/Music.js";
import { ErrorCard } from "./ui/kit.js";
import { Skeleton, SkeletonGuildGrid } from "./ui/skeleton.js";

export function App() {
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
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
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
        <Route path="config" element={<ConfigPage />} />
        <Route path="commands" element={<CommandsPage />} />
        <Route path="commands/new" element={<CommandEditorPage />} />
        <Route path="commands/:commandId" element={<CommandEditorPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="automod" element={<AutomodPage />} />
        <Route path="levels" element={<LevelsPage />} />
        <Route path="music" element={<MusicPage />} />
        <Route path="modlog" element={<ModLogPage />} />
        <Route path="access" element={<PanelAccessPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
