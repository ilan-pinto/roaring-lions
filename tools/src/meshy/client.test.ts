/**
 * `MeshyClient` against a stubbed global `fetch` -- never a real network
 * call. Checks the request shape (method, path, auth header, JSON body) and
 * that a non-2xx response raises `MeshyApiError` with the status and body
 * attached, without ever including the API key in the thrown message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, MeshyApiError, MeshyClient } from './client';

const FAKE_KEY = 'fake-test-key-not-real';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MeshyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getBalance sends a Bearer-authorized GET to /openapi/v1/balance', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${DEFAULT_BASE_URL}/openapi/v1/balance`);
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
      return jsonResponse({ balance: 454 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    await expect(client.getBalance()).resolves.toEqual({ balance: 454 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('submitTextTask POSTs the body as JSON and returns the task id', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${DEFAULT_BASE_URL}/openapi/v2/text-to-3d`);
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
      const body = JSON.parse(String(init?.body)) as { mode: string; prompt: string };
      expect(body.mode).toBe('preview');
      expect(body.prompt).toBe('a desert watchtower');
      return jsonResponse({ result: 'task-123' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    const res = await client.submitTextTask({
      mode: 'preview',
      prompt: 'a desert watchtower',
      model_type: 'standard',
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 30000,
      pose_mode: '',
      target_formats: ['glb'],
      origin_at: 'bottom',
    });
    expect(res).toEqual({ result: 'task-123' });
  });

  it('getTextTask GETs /openapi/v2/text-to-3d/:id', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`${DEFAULT_BASE_URL}/openapi/v2/text-to-3d/task-123`);
      return jsonResponse({ id: 'task-123', status: 'SUCCEEDED', progress: 100 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    await expect(client.getTextTask('task-123')).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('listTextTasks builds a query string from page params', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`${DEFAULT_BASE_URL}/openapi/v2/text-to-3d?page_num=2&page_size=10`);
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    await client.listTextTasks({ pageNum: 2, pageSize: 10 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('deleteTextTask sends DELETE', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    await expect(client.deleteTextTask('task-123')).resolves.toBeUndefined();
  });

  it('submitImageTask POSTs to /openapi/v1/image-to-3d', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`${DEFAULT_BASE_URL}/openapi/v1/image-to-3d`);
      return jsonResponse({ result: 'img-task-1' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    const res = await client.submitImageTask({
      image_url: 'https://example.com/a.png',
      model_type: 'standard',
      ai_model: 'meshy-6',
      topology: 'triangle',
      target_polycount: 30000,
      target_formats: ['glb'],
    });
    expect(res).toEqual({ result: 'img-task-1' });
  });

  it('throws MeshyApiError with status and body on a non-2xx response, without echoing the key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'invalid api key' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY);
    await expect(client.getBalance()).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(MeshyApiError);
      const apiErr = err as MeshyApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.body).toContain('invalid api key');
      expect(apiErr.message).not.toContain(FAKE_KEY);
      return true;
    });
  });

  it('uses a custom base URL when given one', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://custom.example.com/openapi/v1/balance');
      return jsonResponse({ balance: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MeshyClient(FAKE_KEY, 'https://custom.example.com');
    await client.getBalance();
  });
});
