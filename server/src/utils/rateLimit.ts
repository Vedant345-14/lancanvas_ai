/** Fixed-window in-memory rate limiter. Good enough for a single-process LAN server. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 5000) this.prune(now);
      return true;
    }
    h.count++;
    return h.count <= this.limit;
  }
  private prune(now: number) {
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
  }
}
