/* AUTO-GENERATED FILE. DO NOT EDIT MANUALLY. */
export type ExecutionMode = 'client-wasm' | 'server-api' | 'hybrid';

export interface ToolManifest {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
  execution_mode: ExecutionMode;
  input_schema: string;
  output_schema: string;
  wasm_entry?: string;
  api_endpoint?: string;
}

export const toolManifests: ToolManifest[] = [
  {
    "id": "suba-wasm-sample",
    "slug": "subA",
    "name": "墨痕倒序",
    "description": "在浏览器中执行文本倒序，作为 WASM 演示。",
    "tags": [
      "text",
      "wasm"
    ],
    "version": "0.1.0",
    "execution_mode": "client-wasm",
    "input_schema": "schemas/subA-input.json",
    "output_schema": "schemas/subA-output.json",
    "wasm_entry": "reverse_text"
  },
  {
    "id": "subb-server-sample",
    "slug": "subB",
    "name": "墨点计词",
    "description": "在服务端统计文本词数，作为 API 执行示例。",
    "tags": [
      "text",
      "server"
    ],
    "version": "0.1.0",
    "execution_mode": "server-api",
    "input_schema": "schemas/subB-input.json",
    "output_schema": "schemas/subB-output.json",
    "api_endpoint": "/api/tools/v1/run/subb-server-sample"
  }
];
