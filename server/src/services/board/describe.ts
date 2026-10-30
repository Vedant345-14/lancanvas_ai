import type { BoardObject } from '../../types';

const rectOf = (o: BoardObject) => {
  if (o.points && (o.type === 'pen' || o.type === 'highlighter')) {
    const xs = o.points.map((p) => p[0] + o.x), ys = o.points.map((p) => p[1] + o.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  const w = o.w ?? 0, h = o.h ?? 0;
  return { x1: Math.min(o.x, o.x + w), y1: Math.min(o.y, o.y + h), x2: Math.max(o.x, o.x + w), y2: Math.max(o.y, o.y + h) };
};
const inside = (px: number, py: number, r: ReturnType<typeof rectOf>, pad = 0) =>
  px >= r.x1 - pad && px <= r.x2 + pad && py >= r.y1 - pad && py <= r.y2 + pad;
const dist = (px: number, py: number, r: ReturnType<typeof rectOf>) => {
  const dx = Math.max(r.x1 - px, 0, px - r.x2), dy = Math.max(r.y1 - py, 0, py - r.y2);
  return Math.hypot(dx, dy);
};
const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '…' : s).replace(/\s+/g, ' ').trim();

export interface BoardDescription { text: string; counts: Record<string, number>; textItems: number }

/**
 * Converts board objects into a plain-text description with spatial relationships
 * (labels inside shapes, which shapes arrows connect, reading order of loose text).
 * This is *detected structure*, not AI interpretation.
 */
export function describeBoard(objects: BoardObject[]): BoardDescription {
  const counts: Record<string, number> = {};
  for (const o of objects) counts[o.type] = (counts[o.type] ?? 0) + 1;

  const containers = objects.filter((o) => ['rect', 'ellipse', 'sticky', 'image'].includes(o.type));
  const texts = objects.filter((o) => o.type === 'text');
  const labelOf = new Map<string, string[]>();
  const usedTexts = new Set<string>();
  for (const t of texts) {
    const tr = rectOf(t);
    const cx = (tr.x1 + tr.x2) / 2, cy = (tr.y1 + tr.y2) / 2;
    const host = containers
      .filter((c) => c.type !== 'image' && inside(cx, cy, rectOf(c)))
      .sort((a, b) => { const ra = rectOf(a), rb = rectOf(b); return (ra.x2 - ra.x1) * (ra.y2 - ra.y1) - (rb.x2 - rb.x1) * (rb.y2 - rb.y1); })[0];
    if (host) { usedTexts.add(t.id); labelOf.set(host.id, [...(labelOf.get(host.id) ?? []), t.text ?? '']); }
  }
  const nameOf = (o: BoardObject, idx: number): string => {
    const own = o.type === 'sticky' ? o.text : undefined;
    const lab = [own, ...(labelOf.get(o.id) ?? [])].filter(Boolean).join(' / ');
    return lab ? `"${clip(lab, 60)}"` : `unlabeled ${o.type} #${idx + 1}`;
  };

  const lines: string[] = [];
  const named = containers.map((c, i) => ({ c, name: nameOf(c, i) }));
  if (named.length) {
    lines.push('SHAPES, STICKY NOTES AND IMAGES (reading order top-to-bottom, left-to-right):');
    named.sort((a, b) => rectOf(a.c).y1 - rectOf(b.c).y1 || rectOf(a.c).x1 - rectOf(b.c).x1).forEach(({ c, name }) => {
      const r = rectOf(c);
      const body = c.type === 'sticky' ? `: ${clip(c.text ?? '', 300)}` : labelOf.get(c.id) ? `, text: ${clip(labelOf.get(c.id)!.join(' | '), 300)}` : '';
      lines.push(`- ${c.type} ${c.type === 'sticky' ? '' : name} at (${Math.round(r.x1)},${Math.round(r.y1)}) size ${Math.round(r.x2 - r.x1)}x${Math.round(r.y2 - r.y1)}${body}`.replace(/\s+/g, ' '));
    });
  }

  const connectors = objects.filter((o) => o.type === 'arrow' || o.type === 'line');
  const conn: string[] = [];
  for (const k of connectors) {
    const sx = k.x, sy = k.y, ex = k.x + (k.w ?? 0), ey = k.y + (k.h ?? 0);
    const nearest = (px: number, py: number) => named.map((n) => ({ n, d: dist(px, py, rectOf(n.c)) })).filter((e) => e.d <= 70).sort((a, b) => a.d - b.d)[0]?.n.name;
    const a = nearest(sx, sy), b = nearest(ex, ey);
    const verb = k.type === 'arrow' ? 'arrow points from' : 'line joins';
    conn.push(`- ${verb} ${a ?? `empty space (${Math.round(sx)},${Math.round(sy)})`} ${k.type === 'arrow' ? 'to' : 'and'} ${b ?? `empty space (${Math.round(ex)},${Math.round(ey)})`}`);
  }
  if (conn.length) lines.push('', 'CONNECTORS (detected by proximity, may be imperfect):', ...conn);

  const loose = texts.filter((t) => !usedTexts.has(t.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  if (loose.length) {
    lines.push('', 'FREE TEXT BOXES (reading order):');
    for (const t of loose) lines.push(`- at (${Math.round(t.x)},${Math.round(t.y)}): ${clip(t.text ?? '', 500)}`);
  }
  const strokes = objects.filter((o) => o.type === 'pen' || o.type === 'highlighter');
  if (strokes.length) {
    const rs = strokes.map(rectOf);
    lines.push('', `FREEHAND: ${strokes.length} hand-drawn stroke(s) spanning (${Math.round(Math.min(...rs.map((r) => r.x1)))},${Math.round(Math.min(...rs.map((r) => r.y1)))}) to (${Math.round(Math.max(...rs.map((r) => r.x2)))},${Math.round(Math.max(...rs.map((r) => r.y2)))}). Handwriting cannot be read from stroke data; use the board image if provided.`);
  }
  if (!lines.length) lines.push('The board is empty.');
  return { text: lines.join('\n'), counts, textItems: texts.length + objects.filter((o) => o.type === 'sticky').length };
}
