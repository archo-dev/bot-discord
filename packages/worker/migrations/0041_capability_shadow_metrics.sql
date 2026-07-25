-- feat/plan-capability-enforcement: compteurs agrégés du mode SHADOW.
--
-- Le mode shadow calcule la décision d'enforcement qui SERAIT prise (sans jamais
-- bloquer) et l'observe. Aucun pipeline PII-free n'existait pour ça : les
-- product-metrics (0-…) sont opt-in par guilde et hashent le guildId, ce qui ne
-- convient pas à une observation systématique de l'enforcement.
--
-- Cette table est un AGRÉGAT pur : uniquement des dimensions BORNÉES (enums) et
-- un compteur. JAMAIS de userId/guildId/nom de serveur/contenu/token. On ne peut
-- pas ré-identifier un utilisateur ou une guilde à partir de ces lignes.
--
-- Additive, sans impact runtime tant que le mode est "off" (aucune écriture).
-- Appliquée STAGING/LOCAL d'abord — PAS la prod (comme 0032-0040).

CREATE TABLE capability_shadow_metrics (
  day             TEXT NOT NULL,                       -- YYYY-MM-DD (UTC)
  surface         TEXT NOT NULL,                       -- interaction|api|gateway|internal
  capability      TEXT NOT NULL,                       -- CapabilityId (enum stable)
  effective_plan  TEXT NOT NULL,                       -- free|premium|business
  required_plan   TEXT NOT NULL,                       -- free|premium|business
  reason          TEXT NOT NULL,                       -- CapabilityReason (enum)
  decision        TEXT NOT NULL CHECK (decision IN ('allowed', 'would_block')),
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, surface, capability, effective_plan, required_plan, reason, decision)
) WITHOUT ROWID;

-- Lecture opérateur : fenêtre temporelle récente, agrégation par capability/plan.
CREATE INDEX idx_capability_shadow_day ON capability_shadow_metrics(day);
