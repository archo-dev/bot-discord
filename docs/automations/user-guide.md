# Guide utilisateur du Studio

## Activer et créer

1. Dans **Modules**, activez **Studio d’automatisations**. Le Gateway doit être connecté pour les événements Discord temps réel ; les triggers HTTP, D1 et Cron restent gérés par le Worker.
2. Ouvrez **Outils → Automatisations**, puis **Nouvelle automatisation**.
3. Donnez un nom, gardez le workflow inactif pendant sa préparation, puis choisissez le déclencheur dans la carte **SI**.
4. Ajoutez zéro à vingt conditions dans **ET / OU**. `Toutes` exige que chaque carte soit vraie ; `Une au moins` forme un OU.
5. Ajoutez une à vingt actions dans **ALORS** et utilisez les flèches pour fixer leur ordre.
6. Configurez le cooldown et le maximum par minute, enregistrez, lancez **Mode test**, puis activez le workflow.

Les champs texte acceptent `{{user.name}}`, `{{guild.name}}`, `{{channel.name}}`, `{{message.content}}`, `{{reason}}`, `{{warnCount}}`, `{{ticket.id}}` et les autres variables affichées sous l’éditeur. Une variable absente produit une chaîne vide.

## Simulation et diagnostic

Le mode test prend un contexte JSON, évalue le déclencheur et les conditions, puis montre les actions qui seraient exécutées. Il n’envoie aucun message, ne modifie aucun membre et n’écrit aucune donnée métier.

La liste affiche les statistiques sur 30 jours et les exécutions récentes. Une exécution `skipped` signifie généralement condition non satisfaite ou limite atteinte. Après cinq échecs consécutifs, le circuit s’ouvre pendant 15 minutes ; une réactivation manuelle remet ce garde-fou à zéro.

## Import, export et duplication

- **Dupliquer** crée une copie inactive avec un nom unique.
- **Exporter** télécharge une enveloppe JSON versionnée sans historique ni logs.
- **Importer** valide d’abord le format et les schémas. Les IDs de salons et rôles restent spécifiques au serveur : vérifiez-les après un import interserveur.
- Les 50 dernières révisions sont visibles dans l’éditeur. Elles servent à l’audit ; la restauration manuelle consiste à reprendre la configuration du snapshot voulu.

## Bonnes pratiques

- Commencez avec une limite basse et un workflow inactif.
- Ajoutez un cooldown aux événements fréquents (`message_create`, réactions, rôles).
- Placez `wait` avant une action dépendante du temps ; l’attente maximale est 24 heures.
- Activez `Continuer si erreur` uniquement si les actions suivantes restent sûres sans la précédente.
- Les webhooks doivent viser une URL HTTPS publique et répondre en moins de cinq secondes.
