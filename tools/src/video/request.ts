/**
 * The exact HTTP request one take sends, built as data. Pure: the image bytes
 * are passed in, nothing is read or sent here. `cli.ts` prints the REDACTED
 * form on every dry run (the base64 replaced by its size and hash, the key by
 * a placeholder) and sends the real one only behind `--spend`.
 *
 * Shapes, from the vendor's own pages read 2026-10-11:
 *
 * - Veo 3.1 (https://ai.google.dev/gemini-api/docs/veo):
 *   `POST /v1beta/models/<id>:predictLongRunning`, `instances[0]` carrying
 *   `prompt`, `image` and, for a pinned loop, `lastFrame` (each
 *   `{inlineData: {mimeType, data}}`), plus `parameters` (`aspectRatio`,
 *   `resolution`, `durationSeconds`, `personGeneration`). Image-to-video
 *   accepts only `personGeneration: "allow_adult"`; it is sent because the
 *   API requires it, and every prompt still asks for no people.
 * - Gemini Omni Flash (https://ai.google.dev/gemini-api/docs/omni):
 *   `POST /v1beta/interactions` with `model`, an ordered `input` list (the
 *   image or images, then the text), `generation_config.video_config.task`
 *   and a top-level `response_format`. There is no duration and no negative
 *   prompt field; both go in the prompt text, which is why the content rules
 *   are a suffix on every prompt rather than a parameter.
 *
 * Neither page shows the exact JSON for every combination this builds (Veo's
 * first+last example omits `parameters`; Omni shows no image-to-video example
 * with URI delivery). Where this file combines two documented pieces it says
 * so, and the first real call is the check -- Veo does not bill a request that
 * fails, and a 400 is printed with its body.
 */
import { createHash } from 'node:crypto';
import { MODELS, isVeo } from './pricing';
import type { Shot, Stage } from './shots';

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const KEY_HEADER = 'x-goog-api-key';

/**
 * Appended to EVERY prompt. The approved scope is people-free footage of the
 * fictional Kedem setting; Google's filters drop violence and recognisable
 * people, and the project's own setting rule forbids real insignia, flags and
 * text. Saying it every time costs a few tokens and removes a class of take
 * that would be thrown away at review.
 */
export const CONTENT_RULES_SUFFIX =
  ' Keep the camera on terrain, light, weather, buildings and empty ground. ' +
  'No people, no faces, no figures, no soldiers, no animals. No vehicles moving. ' +
  'No text, no captions, no numbers, no flags, no insignia, no emblems, no logos, no religious symbols. ' +
  'No fire, no explosions, no gunfire. No dialogue, no music.';

export function promptFor(shot: Shot): string {
  return `${shot.prompt.trim()}${CONTENT_RULES_SUFFIX}`;
}

export interface StillBytes {
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly bytes: Buffer;
}

export function mimeFor(file: string): StillBytes['mimeType'] {
  return /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
}

export interface BuiltRequest {
  readonly method: 'POST';
  readonly url: string;
  /** Without the key: `cli.ts` adds `KEY_HEADER` only when it sends. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  /** 'veo' polls an operation; 'omni' answers in the response. */
  readonly kind: 'veo' | 'omni';
}

export function buildRequest(shot: Shot, stage: Stage, still: StillBytes): BuiltRequest {
  const plan = shot[stage];
  const prompt = promptFor(shot);
  const data = still.bytes.toString('base64');
  const headers = { 'Content-Type': 'application/json' };
  if (isVeo(plan.model)) {
    const frame = { inlineData: { mimeType: still.mimeType, data } };
    return {
      method: 'POST',
      kind: 'veo',
      url: `${API_BASE}/models/${MODELS[plan.model]}:predictLongRunning`,
      headers,
      body: {
        instances: [{ prompt, image: frame, ...(shot.loop ? { lastFrame: frame } : {}) }],
        // Placement of `parameters` beside `instances` is from the page's
        // other REST examples; its first+last example has none (see header).
        parameters: {
          aspectRatio: '16:9',
          resolution: plan.resolution,
          durationSeconds: plan.seconds,
          personGeneration: 'allow_adult',
        },
      },
    };
  }
  const image = { type: 'image', data, mime_type: still.mimeType };
  return {
    method: 'POST',
    kind: 'omni',
    url: `${API_BASE}/interactions`,
    headers,
    body: {
      model: MODELS[plan.model],
      // Two copies of the still pin both ends (the page's interpolation
      // pattern: first image, last image, then the text).
      input: [...(shot.loop ? [image, image] : [image]), { type: 'text', text: prompt }],
      // `task` is optional; it is named only for the single-image case, and
      // left to the model for interpolation, which has no task value of its own.
      ...(shot.loop ? {} : { generation_config: { video_config: { task: 'image_to_video' } } }),
      response_format: { type: 'video', aspect_ratio: '16:9', resolution: plan.resolution, delivery: 'uri' },
      store: false,
      stream: false,
      background: false,
    },
  };
}

/** The request with every base64 payload replaced by its size and SHA-256,
 *  and the key header shown as a placeholder: what a dry run prints. */
export function redactRequest(req: BuiltRequest): unknown {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === 'data' && typeof val === 'string' && val.length > 256) {
          const raw = Buffer.from(val, 'base64');
          out[k] = `<base64 of ${raw.length} bytes, sha256 ${createHash('sha256').update(raw).digest('hex').slice(0, 16)}>`;
        } else out[k] = swap(val);
      }
      return out;
    }
    return v;
  };
  return {
    method: req.method,
    url: req.url,
    headers: { ...req.headers, [KEY_HEADER]: '<GEMINI_API_KEY from ~/.config/roaring-lions/gemini.env, never printed>' },
    body: swap(req.body),
  };
}
