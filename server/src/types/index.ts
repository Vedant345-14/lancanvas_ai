export type DrawPolicy = 'none' | 'everyone' | 'selected';

export interface Settings {
  drawPolicy: DrawPolicy;
  locked: boolean;
  requireApproval: boolean;
  allowUploads: boolean;
  allowAI: boolean;
  chatToAI: boolean;
  chatEnabled: boolean;
}

export interface Perms {
  canDraw: boolean;
  canUpload: boolean;
  canChat: boolean;
  canAI: boolean;
  canRequest: boolean;
}

export type Role = 'host' | 'participant';
export type Status = 'pending' | 'approved' | 'rejected' | 'removed';

export interface Session {
  id: string;
  code: string;
  name: string;
  passwordHash: string | null;
  hostId: string | null;
  settings: Settings;
  createdAt: number;
  closed: boolean;
}

export interface Participant {
  id: string;
  sessionId: string;
  name: string;
  role: Role;
  status: Status;
  perms: Perms;
  createdAt: number;
}

export type Action = 'draw' | 'upload' | 'chat' | 'ai' | 'clear' | 'manage' | 'request';
export interface Effective {
  draw: boolean; upload: boolean; chat: boolean; ai: boolean; request: boolean; clear: boolean; manage: boolean;
}

export interface BoardObject {
  id: string;
  type: 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'sticky' | 'image';
  x: number;
  y: number;
  w?: number;
  h?: number;
  points?: [number, number][];
  color: string;
  strokeWidth: number;
  fill?: string | null;
  text?: string;
  fontSize?: number;
  src?: string;
  // server-stamped
  author: string;
  z: number;
  ts: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  participantId: string | null;
  senderName: string;
  text: string;
  kind: 'user' | 'system';
  createdAt: number;
}
