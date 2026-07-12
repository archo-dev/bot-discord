/** Discord permission bits used by the bot (subset of the full bitfield). */
export const PermissionBits = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

export type PermissionName = keyof typeof PermissionBits;

/**
 * Check a Discord permission bitfield (decimal string, as sent in interaction
 * payloads and OAuth guild lists) against required bits. ADMINISTRATOR
 * implicitly grants everything.
 */
export function hasPermission(bitfield: string, required: bigint): boolean {
  let bits: bigint;
  try {
    bits = BigInt(bitfield);
  } catch {
    return false;
  }
  if ((bits & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) return true;
  return (bits & required) === required;
}

/** Can the user manage this guild (panel access baseline)? */
export function canManageGuild(bitfield: string): boolean {
  return hasPermission(bitfield, PermissionBits.MANAGE_GUILD);
}
