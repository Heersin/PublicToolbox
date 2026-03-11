export type TargetImageFormat = 'png' | 'jpg' | 'webp';

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

interface ConvertImagePayload {
  file: File;
  targetFormat: TargetImageFormat;
  background?: string;
}

interface ConvertImageOptions {
  timeoutMs?: number;
}

export interface ConvertImageResult {
  blob: Blob;
  fileName: string;
  contentType: string;
}

export class ImageConvertApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ImageConvertApiError';
    this.code = code;
    this.status = status;
  }
}

const IMAGE_CONVERT_ENDPOINT = '/api/media/v1/convert-image';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildRequestCandidates(): string[] {
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
    add(`${trimTrailingSlash(envBase)}${IMAGE_CONVERT_ENDPOINT}`);
  }

  add(IMAGE_CONVERT_ENDPOINT);
  return candidates;
}

function fallbackDownloadName(sourceName: string, targetFormat: TargetImageFormat): string {
  const baseName = sourceName.includes('.') ? sourceName.slice(0, sourceName.lastIndexOf('.')) : sourceName;
  const cleaned = baseName.trim() || 'converted';
  return `${cleaned}-yixing.${targetFormat}`;
}

function parseContentDispositionFileName(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const normalMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] ?? null;
}

function isRetryableError(error: unknown): boolean {
  return (
    error instanceof ImageConvertApiError &&
    (error.code === 'REQUEST_TIMEOUT' ||
      error.code === 'REQUEST_NETWORK_ERROR' ||
      error.code === 'NON_JSON_RESPONSE' ||
      error.code === 'REQUEST_URL_INVALID')
  );
}

async function doConvert(
  requestUrl: string,
  payload: ConvertImagePayload,
  timeoutMs: number,
): Promise<ConvertImageResult> {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append('file', payload.file, payload.file.name);
    formData.append('target_format', payload.targetFormat);
    if (payload.targetFormat === 'jpg' && payload.background) {
      formData.append('background', payload.background);
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      signal: controller.signal,
      body: formData,
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (response.ok) {
      if (!contentType.startsWith('image/')) {
        throw new ImageConvertApiError(
          `unexpected response content type: ${contentType || 'unknown'}`,
          'INVALID_BINARY_RESPONSE',
          response.status,
        );
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const fileName =
        parseContentDispositionFileName(disposition) ??
        fallbackDownloadName(payload.file.name, payload.targetFormat);

      return {
        blob,
        fileName,
        contentType,
      };
    }

    if (!contentType.includes('application/json')) {
      throw new ImageConvertApiError('non-json error response', 'NON_JSON_RESPONSE', response.status);
    }

    let body: ApiResponse<never>;
    try {
      body = (await response.json()) as ApiResponse<never>;
    } catch {
      throw new ImageConvertApiError('non-json error response', 'NON_JSON_RESPONSE', response.status);
    }

    throw new ImageConvertApiError(
      body.error?.message ?? 'image conversion failed',
      body.error?.code ?? 'UNKNOWN_ERROR',
      response.status,
    );
  } catch (error) {
    if (error instanceof ImageConvertApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ImageConvertApiError(`request timeout after ${timeoutMs}ms`, 'REQUEST_TIMEOUT', 408);
    }
    if (error instanceof Error && error.message.includes('did not match the expected pattern')) {
      throw new ImageConvertApiError('request URL is invalid in this browser context', 'REQUEST_URL_INVALID', 0);
    }
    throw new ImageConvertApiError('network request failed', 'REQUEST_NETWORK_ERROR', 0);
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

export async function convertImage(
  payload: ConvertImagePayload,
  options: ConvertImageOptions = {},
): Promise<ConvertImageResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const candidates = buildRequestCandidates();
  let lastError: unknown = null;

  for (const requestUrl of candidates) {
    try {
      return await doConvert(requestUrl, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error;
      }
    }
  }

  if (lastError instanceof ImageConvertApiError) {
    throw new ImageConvertApiError(
      'image convert API is unreachable',
      'REQUEST_UNREACHABLE',
      lastError.status,
    );
  }

  throw new ImageConvertApiError('image convert API is unreachable', 'REQUEST_UNREACHABLE', 0);
}
