# Politique de confidentialité — BROUILLON NON VALIDÉ

> ⚠️ **BROUILLON — NON VALIDÉ JURIDIQUEMENT.** À faire relire/valider (RGPD, D18) avant publication.

## Données collectées

- **Compte Discord** : identifiant, nom, avatar, serveurs administrés (via OAuth).
- **Configuration** du bot par serveur (paramètres de modules).
- **Facturation** : données fournies par le prestataire de paiement (email de facturation, statut d'abonnement) — **jamais** de numéro de carte (checkout hébergé).
- **Support** : contenu des tickets ouverts par l'utilisateur.
- **Techniques** : journaux/métriques **pseudonymisés** (pas d'ID de serveur en clair), hash d'IP dans l'audit.

Aucune donnée n'est vendue.

## Finalités

Fournir et sécuriser le service, gérer les abonnements et emplacements, assurer le support priorisé, respecter les obligations légales et comptables, détecter l'abus/la fraude.

## Base légale

Exécution du contrat (fourniture du service), intérêt légitime (sécurité, prévention de l'abus), obligation légale (comptabilité), consentement le cas échéant.

## Conservation (D18 — à valider)

- Conservation **minimale nécessaire** + obligations comptables pour la facturation.
- **Audit** et **évènements d'abonnement** : longue durée (traçabilité, litiges).
- **Entitlements expirés/révoqués** : conservés (historique, réactivation).
- Purges via tâche planifiée (`23 4 * * *`), **jamais** manuelles non auditées.

## Sous-traitants

- Prestataire de paiement (D3 — à confirmer : MoR ou Stripe).
- Hébergeurs (Cloudflare, OVH).
Liste détaillée et localisations à compléter.

## Droits (RGPD)

Accès, rectification, effacement, portabilité, limitation, opposition. Exercice via [contact]. Réclamation possible auprès de l'autorité de contrôle (CNIL).

## Sécurité

Sessions à cookies opaques (isolation client/Studio), permissions vérifiées serveur, audit immuable, masquage des données sensibles, chiffrement en transit.

---
*Brouillon produit en M16 — à valider (D18/D21).*
