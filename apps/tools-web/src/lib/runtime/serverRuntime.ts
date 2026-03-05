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

interface RunServerOptions {
  timeoutMs?: number;
  traceId?: string;
}

export interface RunToolData {
  [key: string]: unknown;
}

export async function runServerTool(
  apiEndpoint: string,
  toolVersion: string,
  text: string,
  options: RunServerOptions = {},
): Promise<RunToolData> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 5000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        tool_version: toolVersion,
        trace_id: options.traceId,
        input: { text },
      }),
    });

    const payload = (await response.json()) as ApiResponse<RunToolData>;

    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error?.message ?? 'Server tool execution failed');
    }

    return payload.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Server tool timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
