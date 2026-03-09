interface ApiError {
  code: string;
  message: string;
}

interface ApiResponse<TData> {
  success: boolean;
  data: TData | null;
  error: ApiError | null;
  meta: {
    duration_ms: number;
    executor: string;
    version: string;
  };
}

type ClipboardEndpoint = '/api/clipboard/v1/get' | '/api/clipboard/v1/save' | '/api/clipboard/v1/clear';

export interface ClipboardGetData {
  phrase: string;
  text: string;
  has_password: boolean;
  updated_at: string;
  exists: boolean;
}

export interface ClipboardMutationData {
  phrase: string;
  has_password: boolean;
  updated_at: string;
}

export class ClipboardApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ClipboardApiError';
    this.code = code;
    this.status = status;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildRequestCandidates(endpoint: ClipboardEndpoint): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  function add(url: string) {
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  }

  const envBase = (import.meta.env.VITE_TOOLS_API_BASE as string | undefined)?.trim();
  if (envBase) {
    add(`${trimTrailingSlash(envBase)}${endpoint}`);
  }

  add(endpoint);

  const host = window.location.hostname;
  if ((host === '127.0.0.1' || host === 'localhost') && window.location.port !== '8080') {
    add(`http://127.0.0.1:8080${endpoint}`);
    add(`http://localhost:8080${endpoint}`);
  }

  return candidates;
}

function isRetryableError(error: unknown): boolean {
  return (
    error instanceof ClipboardApiError &&
    (error.code === 'REQUEST_URL_INVALID' ||
      error.code === 'REQUEST_NETWORK_ERROR' ||
      error.code === 'NON_JSON_RESPONSE' ||
      error.code === 'REQUEST_TIMEOUT')
  );
}

async function doFetch<TData>(
  requestUrl: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<TData> {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    let body: ApiResponse<TData>;
    try {
      body = (await response.json()) as ApiResponse<TData>;
    } catch {
      throw new ClipboardApiError('non-json response', 'NON_JSON_RESPONSE', response.status);
    }

    if (!response.ok || !body.success || !body.data) {
      throw new ClipboardApiError(
        body.error?.message ?? 'clipboard request failed',
        body.error?.code ?? 'UNKNOWN_ERROR',
        response.status,
      );
    }

    return body.data;
  } catch (error) {
    if (error instanceof ClipboardApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ClipboardApiError(`request timeout after ${timeoutMs}ms`, 'REQUEST_TIMEOUT', 408);
    }
    if (error instanceof Error && error.message.includes('did not match the expected pattern')) {
      throw new ClipboardApiError('request URL is invalid in this browser context', 'REQUEST_URL_INVALID', 0);
    }
    throw new ClipboardApiError('network request failed', 'REQUEST_NETWORK_ERROR', 0);
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

async function requestClipboard<TData>(
  endpoint: ClipboardEndpoint,
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<TData> {
  const candidates = buildRequestCandidates(endpoint);
  let lastError: unknown = null;

  for (const requestUrl of candidates) {
    try {
      return await doFetch<TData>(requestUrl, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error;
      }
    }
  }

  if (lastError instanceof ClipboardApiError) {
    throw new ClipboardApiError('clipboard API is unreachable', 'REQUEST_UNREACHABLE', lastError.status);
  }

  throw new ClipboardApiError('clipboard API is unreachable', 'REQUEST_UNREACHABLE', 0);
}

export async function getClipboard(phrase: string, password: string): Promise<ClipboardGetData> {
  return requestClipboard<ClipboardGetData>('/api/clipboard/v1/get', { phrase, password });
}

export async function saveClipboard(
  phrase: string,
  password: string,
  text: string,
): Promise<ClipboardMutationData> {
  return requestClipboard<ClipboardMutationData>('/api/clipboard/v1/save', { phrase, password, text });
}

export async function clearClipboard(phrase: string, password: string): Promise<ClipboardMutationData> {
  return requestClipboard<ClipboardMutationData>('/api/clipboard/v1/clear', { phrase, password });
}
