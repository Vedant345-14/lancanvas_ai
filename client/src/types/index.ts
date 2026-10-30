export type Tool = 'select' | 'pan' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'sticky';
export type ObjType = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'sticky' | 'image';

export interface BoardObject {
  id: string; type: ObjType; x: number; y: number; w?: number; h?: number;
  points?: [number, number][]; color: string; strokeWidth: number; fill?: string | null;
  text?: string; fontSize?: number; src?: string; author?: string; z?: number; ts?: number;
}
export type NewObject = Omit<BoardObject, 'author' | 'z' | 'ts'>;

export interface Effective { draw: boolean; upload: boolean; chat: boolean; ai: boolean; request: boolean; clear: boolean; manage: boolean }
export interface Perms { canDraw: boolean; canUpload: boolean; canChat: boolean; canAI: boolean; canRequest: boolean }
export interface Me { id: string; name: string; role: 'host' | 'participant'; status: string; perms: Perms; effective: Effective }
export interface Settings {
  drawPolicy: 'none' | 'everyone' | 'selected'; locked: boolean; requireApproval: boolean; allowUploads: boolean;
  allowAI: boolean; chatToAI: boolean; chatEnabled: boolean;
}
export interface Person { id: string; name: string; role: 'host' | 'participant'; online: boolean; canDraw?: boolean }
export interface HostPerson extends Person { status: 'pending' | 'approved'; perms: Perms; effective: Effective; requested: boolean }
export interface ChatMessage { id: string; participantId: string | null; senderName: string; text: string; kind: 'user' | 'system'; createdAt: number }
export interface Preview { id: string; kind: 'pen' | 'highlighter'; color: string; strokeWidth: number; points: [number, number][]; by: string; t: number }
export interface Cursor { id: string; name: string; x: number; y: number; t: number }
export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'success' }
export interface Auth { code: string; token: string; role: 'host' | 'participant'; name: string; classroom: string }
export type Conn = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface Notes {
  title: string; overview: string;
  mainConcepts: { name: string; explanation: string }[];
  definitions: { term: string; definition: string }[];
  steps: { title: string; detail: string }[];
  diagramExplanations: { title: string; observed: string; interpretation: string; uncertain: boolean }[];
  relationships: string[]; keyTerms: string[]; examples: string[]; discussionPoints: string[]; chatQuestions: string[];
  revisionNotes: string[]; practiceQuestions: { question: string; answer: string }[];
  flashcards: { front: string; back: string }[]; quickSummary: string; caveats: string[];
}
export interface NotesResult { id: string; createdAt: number; mode: 'notes' | 'short' | 'flashcards'; visionUsed: boolean; model?: string; notes: Notes }
export interface NetworkInfo { port: number; bindHost: string; addresses: { iface: string; address: string; url: string; isPrivate: boolean; likelyVirtual: boolean; note: string }[] }
