/**
 * A thin fetch wrapper over the two Meshy endpoints this CLI drives, plus
 * balance. No retries, no caching -- `cli.ts` owns polling and progress
 * printing. The API key is passed in at construction and used only in the
 * `Authorization` header; nothing here logs it, and `MeshyApiError` carries
 * the response body but never the request headers.
 */
import type { ImageGenTask, ImageToImageRequest, TextToImageRequest } from './images';
import type {
  BalanceResponse,
  ImageToThreeDRequest,
  ImageToThreeDTask,
  RemeshRequest,
  RemeshTask,
  SubmitTaskResponse,
  TextToThreeDRequest,
  TextToThreeDTask,
} from './api-types';

export const DEFAULT_BASE_URL = 'https://api.meshy.ai';

export class MeshyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'MeshyApiError';
  }
}

export interface ListParams {
  readonly pageNum?: number;
  readonly pageSize?: number;
  readonly sortBy?: string;
}

/**
 * The slice of `MeshyClient` that `runText` (`cli.ts`) actually calls.
 * Narrower than the class itself -- which carries a private `apiKey` field
 * and so cannot be satisfied by a plain object literal -- so tests can pass
 * a fake with no network and no key. `MeshyClient` satisfies this
 * structurally with no `implements` needed.
 */
export interface TextTaskClient {
  submitTextTask(body: TextToThreeDRequest): Promise<SubmitTaskResponse>;
  getTextTask(id: string): Promise<TextToThreeDTask>;
}

/** Same idea as `TextTaskClient`, for `runImage`. */
export interface ImageTaskClient {
  submitImageTask(body: ImageToThreeDRequest): Promise<SubmitTaskResponse>;
  getImageTask(id: string): Promise<ImageToThreeDTask>;
}

/** Same idea as `TextTaskClient`, for `runRemesh`. */
export interface RemeshTaskClient {
  submitRemeshTask(body: RemeshRequest): Promise<SubmitTaskResponse>;
  getRemeshTask(id: string): Promise<RemeshTask>;
}

/** `runT2i` (`cli.ts`)'s slice of the client. */
export interface T2iTaskClient {
  submitT2iTask(body: TextToImageRequest): Promise<SubmitTaskResponse>;
  getT2iTask(id: string): Promise<ImageGenTask>;
}

/** `runI2i`'s slice of the client. */
export interface I2iTaskClient {
  submitI2iTask(body: ImageToImageRequest): Promise<SubmitTaskResponse>;
  getI2iTask(id: string): Promise<ImageGenTask>;
}

function buildQuery(params: Readonly<Record<string, string | number | undefined>>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export class MeshyClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL
  ) {}

  private async request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MeshyApiError(`Meshy API ${method} ${urlPath} -> HTTP ${res.status}`, res.status, text);
    }
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }

  getBalance(): Promise<BalanceResponse> {
    return this.request('GET', '/openapi/v1/balance');
  }

  submitTextTask(body: TextToThreeDRequest): Promise<SubmitTaskResponse> {
    return this.request('POST', '/openapi/v2/text-to-3d', body);
  }

  getTextTask(id: string): Promise<TextToThreeDTask> {
    return this.request('GET', `/openapi/v2/text-to-3d/${encodeURIComponent(id)}`);
  }

  listTextTasks(params: ListParams = {}): Promise<TextToThreeDTask[]> {
    const qs = buildQuery({ page_num: params.pageNum, page_size: params.pageSize, sort_by: params.sortBy });
    return this.request('GET', `/openapi/v2/text-to-3d${qs}`);
  }

  deleteTextTask(id: string): Promise<void> {
    return this.request('DELETE', `/openapi/v2/text-to-3d/${encodeURIComponent(id)}`);
  }

  submitImageTask(body: ImageToThreeDRequest): Promise<SubmitTaskResponse> {
    return this.request('POST', '/openapi/v1/image-to-3d', body);
  }

  getImageTask(id: string): Promise<ImageToThreeDTask> {
    return this.request('GET', `/openapi/v1/image-to-3d/${encodeURIComponent(id)}`);
  }

  listImageTasks(params: ListParams = {}): Promise<ImageToThreeDTask[]> {
    const qs = buildQuery({ page_num: params.pageNum, page_size: params.pageSize, sort_by: params.sortBy });
    return this.request('GET', `/openapi/v1/image-to-3d${qs}`);
  }

  deleteImageTask(id: string): Promise<void> {
    return this.request('DELETE', `/openapi/v1/image-to-3d/${encodeURIComponent(id)}`);
  }

  submitRemeshTask(body: RemeshRequest): Promise<SubmitTaskResponse> {
    return this.request('POST', '/openapi/v1/remesh', body);
  }

  getRemeshTask(id: string): Promise<RemeshTask> {
    return this.request('GET', `/openapi/v1/remesh/${encodeURIComponent(id)}`);
  }

  listRemeshTasks(params: ListParams = {}): Promise<RemeshTask[]> {
    const qs = buildQuery({ page_num: params.pageNum, page_size: params.pageSize, sort_by: params.sortBy });
    return this.request('GET', `/openapi/v1/remesh${qs}`);
  }

  deleteRemeshTask(id: string): Promise<void> {
    return this.request('DELETE', `/openapi/v1/remesh/${encodeURIComponent(id)}`);
  }

  submitT2iTask(body: TextToImageRequest): Promise<SubmitTaskResponse> {
    return this.request('POST', '/openapi/v1/text-to-image', body);
  }

  getT2iTask(id: string): Promise<ImageGenTask> {
    return this.request('GET', `/openapi/v1/text-to-image/${encodeURIComponent(id)}`);
  }

  /** Meshy lists text-to-image and image-to-image tasks together on either path; each row's `type` says which. */
  listT2iTasks(params: ListParams = {}): Promise<ImageGenTask[]> {
    const qs = buildQuery({ page_num: params.pageNum, page_size: params.pageSize, sort_by: params.sortBy });
    return this.request('GET', `/openapi/v1/text-to-image${qs}`);
  }

  submitI2iTask(body: ImageToImageRequest): Promise<SubmitTaskResponse> {
    return this.request('POST', '/openapi/v1/image-to-image', body);
  }

  getI2iTask(id: string): Promise<ImageGenTask> {
    return this.request('GET', `/openapi/v1/image-to-image/${encodeURIComponent(id)}`);
  }

  listI2iTasks(params: ListParams = {}): Promise<ImageGenTask[]> {
    const qs = buildQuery({ page_num: params.pageNum, page_size: params.pageSize, sort_by: params.sortBy });
    return this.request('GET', `/openapi/v1/image-to-image${qs}`);
  }
}
