# Ajouter une Condition

Déclarez un schéma fini et une interface de configuration dans le catalogue, puis enregistrez l’évaluateur. Préférez une comparaison pure sur le contexte. Si une lecture D1 est indispensable, utilisez une requête indexée par serveur et cible ; ne chargez pas une collection entière.

Une condition absente de contexte doit retourner `false`, sauf si sa sémantique explicite est l’absence (`exists` ou « ne possède pas »). Le moteur applique ensuite `negate`. Ajoutez des tests pour `all`, `any`, négation, contexte incomplet et valeurs limites.
