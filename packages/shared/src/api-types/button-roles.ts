/** Button-role message DTOs. */

export interface ButtonRoleDto {
  id: number;
  roleId: string;
  label: string;
  emoji: string | null;
  /** Discord button style: 1 primary, 2 secondary, 3 success, 4 danger. */
  style: number;
}

export interface ButtonRoleMessageDto {
  id: number;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  createdAt: string;
  buttons: ButtonRoleDto[];
}

export interface ButtonRoleMessageCreate {
  channelId: string;
  title: string;
  description: string | null;
  buttons: Array<{ roleId: string; label: string; emoji: string | null; style: number }>;
}
