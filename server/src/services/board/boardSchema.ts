import { z } from 'zod';

const num = z.number().finite().min(-200000).max(200000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const objectShape = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  type: z.enum(['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text', 'sticky', 'image']),
  x: num,
  y: num,
  w: num.optional(),
  h: num.optional(),
  points: z.array(z.tuple([num, num])).min(1).max(4000).optional(),
  color: color.default('#17233C'),
  strokeWidth: z.number().min(1).max(60).default(3),
  fill: color.nullable().optional(),
  text: z.string().max(2000).optional(),
  fontSize: z.number().min(8).max(160).optional(),
  src: z.string().regex(/^[a-f0-9]{24}\.(png|jpg|webp)$/).optional(),
}).strict();

export const objectSchema = objectShape.superRefine((o, ctx) => {
  const need = (cond: boolean, msg: string) => { if (!cond) ctx.addIssue({ code: 'custom', message: msg }); };
  switch (o.type) {
    case 'pen': case 'highlighter': need(!!o.points && o.points.length > 0, 'stroke needs points'); break;
    case 'line': case 'arrow': case 'rect': case 'ellipse': need(o.w !== undefined && o.h !== undefined, 'shape needs w/h'); break;
    case 'text': case 'sticky': need(o.w !== undefined && o.h !== undefined && typeof o.text === 'string', 'text needs w/h/text'); break;
    case 'image': need(!!o.src && o.w !== undefined && o.h !== undefined, 'image needs src/w/h'); break;
  }
});

export const MUTABLE_KEYS = ['x', 'y', 'w', 'h', 'points', 'color', 'strokeWidth', 'fill', 'text', 'fontSize'] as const;
export const patchSchema = objectShape.pick({
  x: true, y: true, w: true, h: true, points: true, color: true, strokeWidth: true, fill: true, text: true, fontSize: true,
}).partial().strict();

export const MAX_OBJECTS_PER_SESSION = 5000;
