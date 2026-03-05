import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';
import { runServerTool } from '../lib/runtime/serverRuntime';
import { runWasmTool } from '../lib/runtime/wasmRuntime';

const MAX_INPUT_CHARS = 20000;
const MAX_WASM_INPUT_CHARS = 5000;

function forceWasmFailureEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('forceWasmFail') === '1';
}

function formatResult(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

export default function ToolEntryPage() {
  const { toolSlug } = useParams();
  const tool = getToolBySlug(toolSlug);
  const [textInput, setTextInput] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [executorLabel, setExecutorLabel] = useState('');

  const canRunWasm = useMemo(
    () =>
      (tool?.execution_mode === 'client-wasm' || tool?.execution_mode === 'hybrid') &&
      Boolean(tool.wasm_entry),
    [tool],
  );
  const canRunServer = useMemo(
    () =>
      (tool?.execution_mode === 'server-api' || tool?.execution_mode === 'hybrid') &&
      Boolean(tool.api_endpoint),
    [tool],
  );

  if (!tool) {
    return (
      <main className="tool-page">
        <h1>工具不存在</h1>
        <p>当前子路由未注册为可用工具，或属于保留路径。</p>
        <Link to="/" className="tool-link">
          返回总览
        </Link>
      </main>
    );
  }

  const activeTool = tool;

  async function runOnServer() {
    if (!canRunServer) {
      throw new Error('当前工具未启用服务端执行。');
    }

    const traceId = `${activeTool.id}-${Date.now()}`;
    const output = await runServerTool(activeTool.api_endpoint!, activeTool.version, textInput, {
      timeoutMs: 5000,
      traceId,
    });
    return output;
  }

  async function handleRun() {
    if (!textInput.trim()) {
      setErrorMessage('请输入文本后再执行。');
      return;
    }

    if (textInput.length > MAX_INPUT_CHARS) {
      setErrorMessage(`输入过长，最多 ${MAX_INPUT_CHARS} 个字符。`);
      return;
    }

    try {
      setRunning(true);
      setErrorMessage('');
      setExecutorLabel('');

      if (activeTool.execution_mode === 'client-wasm') {
        if (!canRunWasm) {
          throw new Error('当前工具未启用 WASM 执行。');
        }

        const output = await runWasmTool(activeTool.wasm_entry!, textInput);
        setResult(formatResult(output));
        setExecutorLabel('client-wasm');
        return;
      }

      if (activeTool.execution_mode === 'server-api') {
        const output = await runOnServer();
        setResult(formatResult(output));
        setExecutorLabel('server-api');
        return;
      }

      if (activeTool.execution_mode === 'hybrid') {
        if (textInput.length > MAX_WASM_INPUT_CHARS) {
          const output = await runOnServer();
          setResult(formatResult(output));
          setExecutorLabel('server-api (guardrail)');
          return;
        }

        try {
          if (forceWasmFailureEnabled()) {
            throw new Error('forced wasm failure');
          }

          if (!canRunWasm) {
            throw new Error('hybrid tool missing wasm runtime');
          }

          const output = await runWasmTool(activeTool.wasm_entry!, textInput);
          setResult(formatResult(output));
          setExecutorLabel('client-wasm');
          return;
        } catch {
          const output = await runOnServer();
          setResult(formatResult(output));
          setExecutorLabel('server-api (fallback)');
          return;
        }
      }

      setErrorMessage('当前工具未实现可执行运行时。');
    } catch (error) {
      setResult('');
      setExecutorLabel('');
      setErrorMessage(error instanceof Error ? error.message : '工具执行失败');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="tool-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/{activeTool.slug}</p>
        <h1>{activeTool.name}</h1>
        <p>{activeTool.description}</p>
      </header>

      <section className="tool-panel">
        <h2>输入区</h2>
        <textarea
          value={textInput}
          onChange={(event) => setTextInput(event.target.value)}
          rows={6}
          className="tool-textarea"
          placeholder="输入要处理的文本"
        />
      </section>

      <section className="tool-panel">
        <h2>执行区</h2>
        <p>当前执行模式：{activeTool.execution_mode}</p>
        <button
          className="tool-button"
          type="button"
          onClick={handleRun}
          disabled={running || (!canRunWasm && !canRunServer)}
        >
          {running ? '执行中...' : '执行'}
        </button>
      </section>

      <section className="tool-panel">
        <h2>结果区</h2>
        {result ? <pre className="tool-result">{result}</pre> : <p>执行后将在此展示结果。</p>}
      </section>

      <section className="tool-panel">
        <h2>错误区</h2>
        <p>{errorMessage || '暂无错误'}</p>
      </section>

      <section className="tool-panel">
        <h2>执行路径</h2>
        <p>{executorLabel || '尚未执行'}</p>
      </section>

      <section className="tool-panel">
        <h2>版本信息</h2>
        <p>version: {activeTool.version}</p>
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
