import type { DB } from '../../database/db';
import type { BoardObject, ChatMessage } from '../../types';
import { newId } from '../../utils/auth';
import { HttpError } from '../../utils/errors';
import { describeBoard } from '../board/describe';
import type { AIProvider } from './provider';
import { Notes, NotesMode, notesSchema } from './schema';

const SYSTEM = `You are a teaching assistant that turns the contents of a classroom whiteboard into accurate study notes (the course is usually Computer Networks, but follow the real content).
Rules:
- Use ONLY information present in the supplied board description, chat transcript and board image. Never invent text, numbers, formulas or facts.
- Keep three things separate: (1) what is literally written/drawn ("observed"), (2) your interpretation ("interpretation"), (3) uncertainty. Set "uncertain": true when a diagram is ambiguous, handwriting is unreadable, or you are inferring a relationship.
- You may add brief standard background ONLY to explain a concept that is actually on the board; label it clearly as background in the explanation.
- If a section has nothing supporting it, return an empty array/string for it.
- Respond with a single JSON object, no markdown fences, using exactly these keys:
title, overview, mainConcepts[{name,explanation}], definitions[{term,definition}], steps[{title,detail}], diagramExplanations[{title,observed,interpretation,uncertain}], relationships[string], keyTerms[string], examples[string], discussionPoints[string], chatQuestions[string], revisionNotes[string], practiceQuestions[{question,answer}], flashcards[{front,back}], quickSummary, caveats[string].`;

const MODE_HINT: Record<NotesMode, string> = {
  notes: 'Produce the complete structured notes. Include 5-8 practice questions and a quick revision summary. Leave flashcards empty.',
  short: 'Produce a SHORT summary: fill only title, overview (max 4 sentences), quickSummary (max 6 bullet-style sentences) and caveats. Leave all other arrays empty.',
  flashcards: 'Produce flashcards (8-15) and practice questions (5-8) with answers from the board content. Fill title and caveats; leave other sections empty.',
};

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* try to find the outermost object */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no json');
}

export class NotesService {
  constructor(private db: DB, private provider: AIProvider) {}
  isConfigured() { return this.provider.isConfigured(); }

  async generate(opts: {
    sessionId: string; sessionName: string; participantId: string; mode: NotesMode;
    objects: BoardObject[]; chat: ChatMessage[] | null; image?: string;
  }) {
    if (!this.provider.isConfigured()) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured on this server. Ask the host to set AI_API_KEY in .env and restart.');
    const desc = describeBoard(opts.objects);
    if (opts.objects.length === 0 && !opts.chat?.length) throw new HttpError(400, 'EMPTY_BOARD', 'The board is empty. Add some content first.');
    const chatText = opts.chat
      ? opts.chat.filter((m) => m.kind === 'user').slice(-150).map((m) => `${m.senderName}: ${m.text}`).join('\n').slice(0, 8000)
      : null;
    const user = [
      `Classroom: ${opts.sessionName}`,
      `Object counts: ${JSON.stringify(desc.counts)}`,
      '', '=== BOARD DESCRIPTION (detected from editable objects) ===', desc.text.slice(0, 14000),
      '', chatText === null ? '=== CHAT === (not shared by the host; do not infer chat content)' : `=== CHAT TRANSCRIPT ===\n${chatText || '(no messages)'}`,
      '', opts.image ? 'A snapshot image of the whole board is attached.' : 'No board image is attached.',
      '', MODE_HINT[opts.mode],
    ].join('\n');

    const result = await this.provider.generate({ system: SYSTEM, user, imageDataUrl: opts.image });
    let notes: Notes;
    try {
      notes = notesSchema.parse(extractJson(result.text));
    } catch {
      throw new HttpError(502, 'AI_BAD_FORMAT', 'The AI response was not in the expected format. Try again.');
    }
    if (opts.image && !result.visionUsed) {
      notes.caveats = ['Visual diagram interpretation was unavailable (the configured model did not accept images). Notes are based on board text and structure only.', ...notes.caveats];
    }
    const saved = { id: newId(), createdAt: Date.now() };
    this.db.prepare('INSERT INTO ai_notes (id, session_id, participant_id, mode, content, vision_used, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(saved.id, opts.sessionId, opts.participantId, opts.mode, JSON.stringify(notes), result.visionUsed ? 1 : 0, saved.createdAt);
    return { id: saved.id, createdAt: saved.createdAt, mode: opts.mode, visionUsed: result.visionUsed, model: this.provider.model, notes, boardDescription: desc.text };
  }

  latest(sessionId: string) {
    const r = this.db.prepare('SELECT * FROM ai_notes WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(sessionId) as
      { id: string; mode: string; content: string; vision_used: number; created_at: number } | undefined;
    return r ? { id: r.id, mode: r.mode, notes: JSON.parse(r.content) as Notes, visionUsed: !!r.vision_used, createdAt: r.created_at } : null;
  }
}
