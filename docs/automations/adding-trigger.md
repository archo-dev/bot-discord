# Ajouter un Trigger

Exemple conceptuel `thread_created` : ajoutez l’ID et sa définition partagée, créez son schéma de filtre (`channelId` optionnel), puis enregistrez un matcher pur. Si Discord est la source, ajoutez le listener Gateway, construisez un contexte borné et ne l’émettez que lorsque `cache.get(guildId).automationTriggers` contient l’ID. Utilisez toujours `buildAutomationEnvelope` et l’outbox ; un événement d’automatisation ne doit pas être envoyé en mode éphémère.

Déclarez explicitement les données de contexte : IDs, noms nécessaires, contenu borné et horodatages ISO. N’ajoutez jamais token, email, payload Discord complet ou donnée sans durée de rétention définie.
