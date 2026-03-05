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

interface RunToolData {
  [key: string]: unknown;
}

export async function runServerTool(apiEndpoint: string, toolVersion: string, text: string): Promise<RunToolData> {
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tool_version: toolVersion,
      input: { text },
    }),
  });

  const payload = (await response.json()) as ApiResponse<RunToolData>;

  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message ?? 'Server tool execution failed');
  }

  return payload.data;
}
