import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOption, ResolvedMember, RoleOption } from "@bot/shared";
import { api } from "../lib/api.js";
import { useResolvedMember } from "../lib/members.js";
import { Icon } from "./icons.js";
import { Combobox, type ComboOption } from "./combobox.js";

/*
 * Wrappers métier de la Combobox : salons et rôles (listes statiques mises en
 * cache, filtrage client) et membres (recherche asynchrone via /members/search).
 * Remplacent les <select> longs et le filtre « ID utilisateur » (plan E3/E4).
 */

function roleColor(color: number): string {
  return color ? `#${color.toString(16).padStart(6, "0")}` : "#99AAB5";
}

interface ChannelSelectProps {
  guildId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Types Discord acceptés (défaut : texte 0 + annonces 5). */
  types?: number[];
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  id?: string;
}

export function ChannelSelect({ guildId, value, onChange, types = [0, 5], placeholder = "Choisir un salon…", clearable = true, invalid, id }: ChannelSelectProps) {
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
    staleTime: 60_000,
  });
  const options: ComboOption[] = useMemo(
    () =>
      (channels.data ?? [])
        .filter((ch) => types.includes(ch.type))
        .map((ch) => ({
          id: ch.id,
          label: ch.name,
          leading: <span className="[&_svg]:h-4 [&_svg]:w-4">{Icon.hash()}</span>,
        })),
    [channels.data, types],
  );
  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={channels.isLoading ? "Chargement des salons…" : placeholder}
      clearable={clearable}
      invalid={invalid}
      emptyText="Aucun salon."
    />
  );
}

interface RoleSelectProps {
  guildId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Cache les rôles gérés par une intégration (non assignables manuellement). */
  excludeManaged?: boolean;
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  id?: string;
}

export function RoleSelect({ guildId, value, onChange, excludeManaged = false, placeholder = "Choisir un rôle…", clearable = true, invalid, id }: RoleSelectProps) {
  const roles = useQuery({
    queryKey: ["roles", guildId],
    queryFn: () => api<RoleOption[]>(`/api/guilds/${guildId}/roles`),
    staleTime: 60_000,
  });
  const options: ComboOption[] = useMemo(
    () =>
      (roles.data ?? [])
        .filter((r) => !excludeManaged || !r.managed)
        .map((r) => ({
          id: r.id,
          label: r.name,
          leading: <span className="h-2.5 w-2.5 rounded-full" style={{ background: roleColor(r.color) }} />,
        })),
    [roles.data, excludeManaged],
  );
  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={roles.isLoading ? "Chargement des rôles…" : placeholder}
      clearable={clearable}
      invalid={invalid}
      emptyText="Aucun rôle."
    />
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function MemberAvatar({ src }: { src: string }) {
  return <img src={src} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 rounded-full bg-(--surface-3) object-cover" />;
}

interface MemberComboboxProps {
  guildId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  id?: string;
}

/** Recherche de membre (plan E4) — remplace la saisie brute d'un snowflake. */
export function MemberCombobox({ guildId, value, onChange, placeholder = "Rechercher un membre…", clearable = true, id }: MemberComboboxProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ["member-search", guildId, debounced],
    queryFn: () => api<ResolvedMember[]>(`/api/guilds/${guildId}/members/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  const selectedMember = useResolvedMember(value);
  const options: ComboOption[] = (search.data ?? []).map((m) => ({
    id: m.id,
    label: m.displayName,
    keywords: m.username,
    leading: <MemberAvatar src={m.avatarUrl} />,
    meta: m.username !== m.displayName ? `@${m.username}` : undefined,
  }));

  const selectedOption: ComboOption | null = value
    ? selectedMember
      ? { id: value, label: selectedMember.displayName, leading: <MemberAvatar src={selectedMember.avatarUrl} /> }
      : { id: value, label: `Utilisateur ${value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-2)}` : value}` }
    : null;

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      onSearch={setQuery}
      loading={debounced.length > 0 && search.isFetching}
      placeholder={placeholder}
      clearable={clearable}
      selectedOption={selectedOption}
      emptyText="Aucun membre trouvé."
    />
  );
}
