/** Salons vocaux temporaires (M26) : réglages « join to create » par serveur. */

export interface TempVoiceSettingsDto {
  enabled: boolean;
  /** Salon vocal déclencheur ; null = non configuré (système inerte). */
  lobbyChannelId: string | null;
  /** Catégorie des salons créés ; null = même catégorie que le lobby. */
  categoryId: string | null;
  /** Modèle de nom, `{user}` = pseudo du propriétaire. */
  nameTemplate: string;
  /** Limite d'utilisateurs par défaut (0 = illimité). */
  userLimit: number;
  /** Plafond de salons temporaires simultanés par serveur. */
  maxChannels: number;
  /** Lecture seule : nombre de salons temporaires actuellement enregistrés. */
  activeChannels: number;
}
