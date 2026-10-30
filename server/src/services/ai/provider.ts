import type { Config } from '../../config';
import { HttpError } from '../../utils/errors';

export interface AIRequest { system: string; user: string; imageDataUrl?: string; signal?: AbortSignal }
export interface AIResult { text: string; visionUsed: boolean }
export interface AIProvider {
  isConfigured(): boolean;
  readonly model: string;
  generate(req: AIRequest): Promise<AIResult>;
}

/**
 * Adapter for any OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter, Groq, Ollama, LM Studio...).
 * To support a different provider, implement AIProvider and pass it to createApp() — the rest of the app is unchanged.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(private cfg: Config['ai'], private fetchImpl: typeof fetch = fetch, private timeoutMs = 90_000) {}
  get model() { return this.cfg.model; }
  isConfigured() { return !!this.cfg.apiKey; }

  async generate(req: AIRequest): Promise<AIResult> {
    if (!this.isConfigured()) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured on this server. Set AI_API_KEY in .env and restart.');
    const wantVision = !!req.imageDataUrl && this.cfg.vision;
    try {
      return { text: await this.call(req, wantVision), visionUsed: wantVision };
    } catch (e) {
      // Many text-only models reject image parts with a 400; retry once without the image.
      if (wantVision && e instanceof HttpError && e.code === 'AI_REJECTED') {
        return { text: await this.call(req, false), visionUsed: false };
      }
      throw e;
    }
  }

  private async call(req: AIRequest, withImage: boolean): Promise<string> {
    const userContent = withImage
      ? [{ type: 'text', text: req.user }, { type: 'image_url', image_url: { url: req.imageDataUrl } }]
      : req.user;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: userContent }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        if (res.status === 401 || res.status === 403) throw new HttpError(502, 'AI_AUTH', 'The AI provider rejected the API key.');
        if (res.status === 429) throw new HttpError(429, 'AI_RATE_LIMIT', 'The AI provider is rate-limiting requests. Try again shortly.');
        if (res.status === 400) throw new HttpError(502, 'AI_REJECTED', `The AI provider rejected the request. ${body}`);
        throw new HttpError(502, 'AI_UPSTREAM', `The AI provider returned an error (${res.status}).`);
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new HttpError(502, 'AI_EMPTY', 'The AI provider returned an empty response.');
      return text;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if ((e as Error).name === 'AbortError') throw new HttpError(504, 'AI_TIMEOUT', 'The AI request timed out.');
      throw new HttpError(502, 'AI_NETWORK', 'Could not reach the AI provider. Check AI_BASE_URL and internet access on the host.');
    } finally {
      clearTimeout(timer);
    }
  }
}
