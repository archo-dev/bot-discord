import { useEffect, useState } from "react";
import type { RolloutResponse } from "@bot/shared";
import { StudioApiError, studioApi } from "../api.js";
import { errorInfoFr } from "../lib/errors.js";
import { AsyncButton, ErrorState, Table, TableSkeleton, Td, useToast } from "../ui/index.js";

const HEADERS = ["Flag", "Global", "Cohorte (guildes)", ""];

export function RolloutPanel({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<RolloutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [globalDraft, setGlobalDraft] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const reload = () => {
    setError(null);
    return studioApi.rollout().then(setData).catch((e: unknown) => setError(e instanceof StudioApiError ? e.code : "network_error"));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (flag: string, global: boolean, guildsCsv: string) => {
    try {
      const guilds = guildsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      await studioApi.setRollout(flag, { global, guilds });
      toast.success("Rollout enregistré", `Flag « ${flag} » mis à jour.`);
      await reload();
    } catch (e) {
      const info = errorInfoFr(e instanceof StudioApiError ? e.code : "error");
      toast.error(info.title, info.description);
    }
  };

  if (error) return <ErrorState code={error} onRetry={() => void reload()} />;
  if (!data) return <TableSkeleton headers={HEADERS} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Activation par cohortes (guildes pilotes) — sans redéploiement. Le global reste off en production.</p>
      <Table headers={HEADERS}>
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
                  <AsyncButton
                    tone="primary"
                    busyLabel="Enregistrement…"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => save(f.flag, globalDraft[f.flag] ?? f.global, draft[f.flag] ?? f.guilds.join(","))}
                  >
                    Enregistrer
                  </AsyncButton>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
