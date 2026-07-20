import { NavLink } from "react-router";

/* Liens de navigation publique (M2). Pointent vers des routes publiques
   qui n'existent qu'avec le flag `platform.publicSite` ON — donc ce composant
   n'est monté que dans ce cas (via PublicLayout). Contenu final = M3+. */
const LINKS = [
  { to: "/features", label: "Fonctions" },
  { to: "/pricing", label: "Tarifs" },
  { to: "/updates", label: "Mises à jour" },
  { to: "/status", label: "Statut" },
] as const;

export function PublicNav({ onNavigate, orientation = "horizontal" }: { onNavigate?: () => void; orientation?: "horizontal" | "vertical" }) {
  const wrap = orientation === "vertical" ? "flex flex-col gap-1" : "flex items-center gap-1";
  return (
    <nav aria-label="Navigation principale" className={wrap}>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `rounded-lg px-3 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
              isActive ? "bg-(--primary-subtle) text-white" : "text-zinc-400 hover:bg-(--state-hover) hover:text-zinc-200"
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
