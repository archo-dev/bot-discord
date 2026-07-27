/** Permanent, non-dismissable environment banner — extracted verbatim from App (M12). */
export function ProductionBanner() {
  const isStaging = import.meta.env.MODE === "staging";
  return (
    <div className="sticky top-0 z-10 bg-red-900/90 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-widest text-red-100">
      {isStaging ? "⬤ Environnement STAGING — actions de test" : "⬤ Environnement PRODUCTION — actions réelles"}
    </div>
  );
}
