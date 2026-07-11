import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PanelAccessEntry, RoleOption } from "@bot/shared";
import { api, ApiError } from "../lib/api.js";
import { Button, Card, Chip, InfoCard, Input } from "../ui/kit.js";
import { SaveBar, useDirty } from "../ui/savebar.js";
import { SkeletonSettingsPage } from "../ui/skeleton.js";
import { Icon } from "../ui/icons.js";

type Level = "admin" | "moderator";
interface Grant {
  id: string;
  level: Level;
}

/** Segmented admin/moderator picker for a single grant (M15). */
function LevelSelect({ value, onChange }: { value: Level; onChange: (v: Level) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-zinc-700 p-0.5 text-xs">
      {(["admin", "moderator"] as const).map((lvl) => (
        <button
          key={lvl}
          type="button"
          aria-pressed={value === lvl}
          onClick={() => onChange(lvl)}
          className={`rounded-md px-2.5 py-1 font-medium transition ${
            value === lvl ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {lvl === "admin" ? "Admin" : "Modérateur"}
        </button>
      ))}
    </div>
  );
}

/** Stable, level-aware projection for dirty comparison. */
function project(grants: Grant[]): string[] {
  return grants.map((g) => `${g.id}:${g.level}`).sort();
}

export function PanelAccessPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const entries = useQuery({
    queryKey: ["panel-access", guildId],
    queryFn: () => api<PanelAccessEntry[]>(`/api/guilds/${guildId}/panel-access`),
    retry: false,
  });
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
  });

  const [roleGrants, setRoleGrants] = useState<Grant[]>([]);
  const [userGrants, setUserGrants] = useState<Grant[]>([]);
  const [newUserId, setNewUserId] = useState("");

  const hydrate = (data: PanelAccessEntry[]) => {
    setRoleGrants(data.filter((e) => e.subjectType === "role").map((e) => ({ id: e.subjectId, level: e.level })));
    setUserGrants(data.filter((e) => e.subjectType === "user").map((e) => ({ id: e.subjectId, level: e.level })));
  };

  useEffect(() => {
    if (entries.data) hydrate(entries.data);
  }, [entries.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/guilds/${guildId}/panel-access`, {
        method: "PUT",
        body: JSON.stringify([
          ...roleGrants.map((g) => ({ subjectType: "role", subjectId: g.id, level: g.level })),
          ...userGrants.map((g) => ({ subjectType: "user", subjectId: g.id, level: g.level })),
        ]),
      }),
    meta: { silentError: true },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["panel-access", guildId] }),
  });

  const initial = entries.data
    ? {
        roles: project(entries.data.filter((e) => e.subjectType === "role").map((e) => ({ id: e.subjectId, level: e.level }))),
        users: project(entries.data.filter((e) => e.subjectType === "user").map((e) => ({ id: e.subjectId, level: e.level }))),
      }
    : undefined;
  const dirty = useDirty({ roles: project(roleGrants), users: project(userGrants) }, initial);
  const resetForm = () => entries.data && hydrate(entries.data);

  const toggleRole = (roleId: string) =>
    setRoleGrants((prev) =>
      prev.some((g) => g.id === roleId) ? prev.filter((g) => g.id !== roleId) : [...prev, { id: roleId, level: "admin" }],
    );
  const setRoleLevel = (roleId: string, level: Level) =>
    setRoleGrants((prev) => prev.map((g) => (g.id === roleId ? { ...g, level } : g)));
  const setUserLevel = (userId: string, level: Level) =>
    setUserGrants((prev) => prev.map((g) => (g.id === userId ? { ...g, level } : g)));

  if (entries.isPending) return <SkeletonSettingsPage cards={2} />;

  if (entries.isError && entries.error instanceof ApiError && entries.error.status === 403) {
    return (
      <p className="text-zinc-400">
        Seuls les membres avec la permission « Gérer le serveur » peuvent configurer l'accès au panel.
      </p>
    );
  }

  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="max-w-2xl space-y-6">
      <Card
        title="Rôles autorisés"
        description="Les membres de ces rôles peuvent utiliser le panel même sans la permission « Gérer le serveur »."
      >
        <div className="flex flex-wrap gap-2">
          {roles.data
            ?.filter((r) => !r.managed)
            .map((r) => (
              <Chip key={r.id} selected={roleGrants.some((g) => g.id === r.id)} onClick={() => toggleRole(r.id)}>
                {r.name}
              </Chip>
            ))}
        </div>
        {roleGrants.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {roleGrants.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-zinc-200">{roleName(g.id)}</span>
                <LevelSelect value={g.level} onChange={(level) => setRoleLevel(g.id, level)} />
                <button
                  onClick={() => toggleRole(g.id)}
                  className="text-zinc-500 transition hover:text-red-400"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Utilisateurs autorisés (par ID)">
        <div className="flex gap-2">
          <Input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="ID utilisateur Discord"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (/^\d{5,20}$/.test(newUserId) && !userGrants.some((g) => g.id === newUserId)) {
                setUserGrants((prev) => [...prev, { id: newUserId, level: "admin" }]);
                setNewUserId("");
              }
            }}
          >
            Ajouter
          </Button>
        </div>
        <ul className="mt-3 space-y-1.5">
          {userGrants.map((g) => (
            <li key={g.id} className="flex items-center gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-sm">
              <code className="min-w-0 flex-1 truncate">{g.id}</code>
              <LevelSelect value={g.level} onChange={(level) => setUserLevel(g.id, level)} />
              <button
                onClick={() => setUserGrants((prev) => prev.filter((u) => u.id !== g.id))}
                className="text-zinc-500 transition hover:text-red-400"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <InfoCard icon={<Icon.key />} title="Bon à savoir">
        Les membres avec la permission « Gérer le serveur » ont <b>toujours</b> un accès admin complet. <b>Admin</b> =
        accès en lecture/écriture ; <b>Modérateur</b> = lecture seule (tout consulter, rien modifier). Un membre visé
        par plusieurs accès obtient le niveau le plus élevé.
      </InfoCard>

      <SaveBar
        dirty={dirty}
        status={save.isPending ? "pending" : save.isError ? "error" : save.isSuccess ? "success" : "idle"}
        onSave={() => save.mutate()}
        onReset={resetForm}
        errorMessage="Échec — la permission « Gérer le serveur » est requise."
      />
    </div>
  );
}
