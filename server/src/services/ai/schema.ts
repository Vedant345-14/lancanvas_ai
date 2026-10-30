import { z } from 'zod';

const strs = z.array(z.string()).default([]);
export const notesSchema = z.object({
  title: z.string().default('Untitled session'),
  overview: z.string().default(''),
  mainConcepts: z.array(z.object({ name: z.string(), explanation: z.string() })).default([]),
  definitions: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  steps: z.array(z.object({ title: z.string(), detail: z.string() })).default([]),
  diagramExplanations: z.array(z.object({
    title: z.string(),
    observed: z.string().default(''),        // what is literally on the board
    interpretation: z.string().default(''),  // AI interpretation
    uncertain: z.boolean().default(false),
  })).default([]),
  relationships: strs,
  keyTerms: strs,
  examples: strs,
  discussionPoints: strs,
  chatQuestions: strs,
  revisionNotes: strs,
  practiceQuestions: z.array(z.object({ question: z.string(), answer: z.string().default('') })).default([]),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })).default([]),
  quickSummary: z.string().default(''),
  caveats: strs,
});
export type Notes = z.infer<typeof notesSchema>;
export type NotesMode = 'notes' | 'short' | 'flashcards';
export const generateSchema = z.object({
  mode: z.enum(['notes', 'short', 'flashcards']).default('notes'),
  image: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
}).strict();
