import initWasm, { reverse_text } from '../../wasm/pkg/tool_wasm';

let initialized = false;

async function ensureWasmInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  await initWasm();
  initialized = true;
}

export async function runWasmTool(entry: string, inputText: string): Promise<string> {
  await ensureWasmInitialized();

  switch (entry) {
    case 'reverse_text':
      return reverse_text(inputText);
    default:
      throw new Error(`Unsupported wasm entry: ${entry}`);
  }
}
