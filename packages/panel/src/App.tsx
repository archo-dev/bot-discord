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

export function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    retry: false,
  });

  if (me.isPending) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-400">Chargement…</div>;
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
    return (
      <div className="flex min-h-screen items-center justify-center text-red-400">
        Erreur de connexion au serveur — réessayez plus tard.
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
        <Route path="modlog" element={<ModLogPage />} />
        <Route path="access" element={<PanelAccessPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
