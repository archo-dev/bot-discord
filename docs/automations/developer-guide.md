# Guide développeur Automation Engine

## Ajouter un composant

La procédure est identique pour les trois registres :

1. Ajouter l’identifiant au tuple `AUTOMATION_*_IDS` dans `packages/shared/src/automation.ts`.
2. Déclarer les métadonnées dans `AUTOMATION_*` : nom, description, version, catégorie, permissions et champs de configuration.
3. Définir le schéma Zod dans `*_CONFIG`. Ne jamais utiliser `passthrough` pour une configuration concrète sensible.
4. Enregistrer l’implémentation avec `registerAutomationTrigger`, `registerAutomationCondition` ou `registerAutomationAction` dans `packages/worker/src/automation/registry.ts`.
5. Si la source est Gateway, abonner uniquement l’événement Discord nécessaire dans `packages/gateway/src/automations.ts`, filtrer via `automationTriggers`, puis utiliser l’enveloppe durable.
6. Ajouter les tests de schéma, registre, cas nominal, permissions, erreur, idempotence et boucle.
7. Documenter les variables de contexte produites et la permission Discord requise.

Le moteur principal ne doit pas être modifié pour un nouveau composant. Une modification y est justifiée uniquement si elle ajoute une garantie transversale (ordonnancement, retry, limite, métrique).

## Contrat d’un Trigger

Un matcher est pur, synchrone et reçoit une configuration déjà validée et un `AutomationEventContext`. Il doit d’abord vérifier le type d’événement. Un filtre absent signifie « toute valeur ». Le Gateway ne doit jamais scanner les workflows : `/internal/config` retourne l’ensemble distinct des triggers actifs.

## Contrat d’une Condition

Une condition retourne un booléen ou une promesse de booléen. Les lectures D1 doivent être indexées et limitées au `guildId` du runtime. `negate` est appliqué par le registre après l’évaluateur ; une implémentation ne le traite pas elle-même. Aucun `eval`, `Function`, script ou regex non bornée n’est autorisé.

## Contrat d’une Action

Une action retourne `continue`, `stop` ou `defer`. Elle reçoit une configuration dont les templates ont déjà été rendus. Elle doit vérifier les IDs de contexte, respecter le module métier, laisser Discord appliquer ses permissions et ajouter les contrôles owner/hiérarchie quand une cible est modifiée. Les opérations D1 + Discord utilisent réservation et compensation. Les messages gardent `allowed_mentions.parse = []`. Les erreurs restent bornées et sans secret.

`defer` écrit une tâche et termine le tour Worker. À la reprise, les actions déjà réussies sont sautées. N’utilisez jamais `setTimeout` pour simuler une attente métier.

## Tests minimaux

- validation acceptée/rejetée du schéma et complétude du registre ;
- scénario de simulation sans mutation ;
- concurrence sur claim ou quota et replay du même event ID ;
- profondeur/TTL et suppression d’une boucle auto-produite ;
- permissions, owner et hiérarchie pour toute action sensible ;
- import/export versionné ;
- migration locale complète puis suites Worker, Gateway et Panel.
