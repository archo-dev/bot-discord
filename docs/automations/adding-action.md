# Ajouter une Action

Déclarez les champs et permissions dans le contrat partagé, validez-les avec Zod, puis enregistrez un exécuteur. Le mode simulation est fourni par l’enveloppe du registre : l’exécuteur réel ne doit pas être appelé lorsque `dryRun` est actif.

Pour une action composée D1 + Discord, utilisez une réservation ou un état intermédiaire durable, finalisez après succès, et compensez l’état si Discord refuse. Pour une action pouvant provoquer le même trigger (rôle, ticket, sanction), ajoutez une suppression bornée ou propagez une profondeur corrélée avant de l’activer. Une action sensible doit tester owner et hiérarchie en plus de déclarer la permission requise.
