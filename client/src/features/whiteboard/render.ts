import type { BoardObject } from '../../types';

export interface Box { x: number; y: number; w: number; h: number }
export const FONT = (size: number) => `${size}px "Inter Variable", Inter, system-ui, sans-serif`;
export const STICKY_FONT = 18;

export function bboxOf(o: BoardObject): Box {
  if ((o.type === 'pen' || o.type === 'highlighter') && o.points?.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [px, py] of o.points) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
    const pad = o.strokeWidth / 2;
    return { x: x1 + o.x - pad, y: y1 + o.y - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }
  const w = o.w ?? 0, h = o.h ?? 0;
  return { x: Math.min(o.x, o.x + w), y: Math.min(o.y, o.y + h), w: Math.abs(w), h: Math.abs(h) };
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measure(text: string, size: number, maxWidth?: number): { lines: string[]; w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = FONT(size);
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth) { lines.push(para); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (measureCtx.measureText(test).width > maxWidth && line) { lines.push(line.trimEnd()); line = word.trimStart(); } else line = test;
    }
    lines.push(line);
  }
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width), 10);
  return { lines, w, h: lines.length * size * 1.3 };
}

const imageCache = new Map<string, HTMLImageElement>();
export function getImage(url: string, onLoad: () => void): HTMLImageElement | null {
  let img = imageCache.get(url);
  if (!img) { img = new Image(); img.onload = onLoad; img.src = url; imageCache.set(url, img); }
  return img.complete && img.naturalWidth ? img : null;
}
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const cached = imageCache.get(url);
    if (cached?.complete && cached.naturalWidth) return resolve(cached);
    const img = cached ?? new Image();
    img.onload = () => resolve(img); img.onerror = () => resolve(null);
    if (!cached) { img.src = url; imageCache.set(url, img); }
  });
}

function strokePath(ctx: CanvasRenderingContext2D, pts: [number, number][], ox: number, oy: number) {
  ctx.beginPath();
  if (pts.length === 1) { ctx.arc(pts[0][0] + ox, pts[0][1] + oy, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2 + ox, my = (pts[i][1] + pts[i + 1][1]) / 2 + oy;
    ctx.quadraticCurveTo(pts[i][0] + ox, pts[i][1] + oy, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] + ox, last[1] + oy);
  ctx.stroke();
}

export function drawObject(ctx: CanvasRenderingContext2D, o: BoardObject, imageFor: (src: string) => HTMLImageElement | null) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.strokeWidth;
  switch (o.type) {
    case 'pen': if (o.points?.length) strokePath(ctx, o.points, o.x, o.y); break;
    case 'highlighter':
      if (o.points?.length) { ctx.globalAlpha = 0.35; ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; strokePath(ctx, o.points, o.x, o.y); }
      break;
    case 'line': case 'arrow': {
      const x2 = o.x + (o.w ?? 0), y2 = o.y + (o.h ?? 0);
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(x2, y2); ctx.stroke();
      if (o.type === 'arrow') {
        const a = Math.atan2(y2 - o.y, x2 - o.x), len = 10 + o.strokeWidth * 2.2;
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45));
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45));
        ctx.stroke();
      }
      break;
    }
    case 'rect': {
      const b = bboxOf(o);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(b.x, b.y, b.w, b.h); }
      ctx.strokeRect(b.x, b.y, b.w, b.h); break;
    }
    case 'ellipse': {
      const b = bboxOf(o);
      ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 0.5), Math.max(b.h / 2, 0.5), 0, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      ctx.stroke(); break;
    }
    case 'text': {
      const size = o.fontSize ?? 22; const b = bboxOf(o);
      ctx.font = FONT(size); ctx.textBaseline = 'top';
      measure(o.text ?? '', size).lines.forEach((l, i) => ctx.fillText(l, b.x + 4, b.y + 4 + i * size * 1.3));
      break;
    }
    case 'sticky': {
      const b = bboxOf(o);
      ctx.shadowColor = 'rgba(23,35,60,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = o.fill || '#FEF08A';
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#17233C'; ctx.font = FONT(o.fontSize ?? STICKY_FONT); ctx.textBaseline = 'top';
      const size = o.fontSize ?? STICKY_FONT;
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      measure(o.text ?? '', size, Math.max(b.w - 20, 20)).lines.forEach((l, i) => ctx.fillText(l, b.x + 10, b.y + 10 + i * size * 1.3));
      break;
    }
    case 'image': {
      const b = bboxOf(o); const img = o.src ? imageFor(o.src) : null;
      if (img) ctx.drawImage(img, b.x, b.y, b.w, b.h);
      else { ctx.fillStyle = '#EEF1F8'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#9AA4BA'; ctx.font = FONT(14); ctx.fillText('Loading image…', b.x + 10, b.y + 20); }
      break;
    }
  }
  ctx.restore();
}

// ---------- hit testing ----------
const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
export function hitObject(o: BoardObject, px: number, py: number, tol: number): boolean {
  const b = bboxOf(o);
  switch (o.type) {
    case 'pen': case 'highlighter': {
      const pts = o.points ?? []; const r = Math.max(tol, o.strokeWidth / 2 + 2);
      if (pts.length === 1) return Math.hypot(px - o.x - pts[0][0], py - o.y - pts[0][1]) <= r;
      for (let i = 0; i < pts.length - 1; i++) if (distSeg(px, py, pts[i][0] + o.x, pts[i][1] + o.y, pts[i + 1][0] + o.x, pts[i + 1][1] + o.y) <= r) return true;
      return false;
    }
    case 'line': case 'arrow': return distSeg(px, py, o.x, o.y, o.x + (o.w ?? 0), o.y + (o.h ?? 0)) <= tol + o.strokeWidth / 2;
    case 'rect': {
      if (o.fill) return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
      const inner = px > b.x + tol && px < b.x + b.w - tol && py > b.y + tol && py < b.y + b.h - tol;
      const outer = px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
      return outer && !inner;
    }
    case 'ellipse': {
      const rx = b.w / 2 || 1, ry = b.h / 2 || 1; const nx = (px - b.x - rx) / rx, ny = (py - b.y - ry) / ry;
      const d = Math.sqrt(nx * nx + ny * ny); const band = tol / Math.min(rx, ry);
      return o.fill ? d <= 1 + band : Math.abs(d - 1) <= band + 0.02;
    }
    default: return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }
}
export function topHit(objs: BoardObject[], px: number, py: number, tol: number): BoardObject | null {
  for (let i = objs.length - 1; i >= 0; i--) if (hitObject(objs[i], px, py, tol)) return objs[i];
  return null;
}

// ---------- snapshot ----------
export async function renderSnapshot(objs: BoardObject[], urlFor: (src: string) => string, opts: { maxDim?: number; margin?: number } = {}): Promise<HTMLCanvasElement | null> {
  if (!objs.length) return null;
  const margin = opts.margin ?? 40, maxDim = opts.maxDim ?? 2000;
  const boxes = objs.map(bboxOf);
  const x1 = Math.min(...boxes.map((b) => b.x)) - margin, y1 = Math.min(...boxes.map((b) => b.y)) - margin;
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + margin, y2 = Math.max(...boxes.map((b) => b.y + b.h)) + margin;
  const bw = Math.max(x2 - x1, 200), bh = Math.max(y2 - y1, 150);
  const scale = Math.min(1.5, maxDim / Math.max(bw, bh));
  const c = document.createElement('canvas'); c.width = Math.ceil(bw * scale); c.height = Math.ceil(bh * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
  const imgs = new Map<string, HTMLImageElement | null>();
  await Promise.all(objs.filter((o) => o.type === 'image' && o.src).map(async (o) => imgs.set(o.src!, await loadImage(urlFor(o.src!)))));
  ctx.scale(scale, scale); ctx.translate(-x1, -y1);
  for (const o of objs) drawObject(ctx, o, (s) => imgs.get(s) ?? null);
  return c;
}
export const lighten = (hex: string, amount = 0.82) => {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (v: number) => Math.round(v + (255 - v) * amount);
  return '#' + [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
};
export const newId = () => 'o' + Array.from(crypto.getRandomValues(new Uint8Array(10))).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
