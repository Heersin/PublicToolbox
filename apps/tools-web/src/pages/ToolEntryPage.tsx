import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';
import { runWasmTool } from '../lib/runtime/wasmRuntime';

export default function ToolEntryPage() {
  const { toolSlug } = useParams();
  const tool = getToolBySlug(toolSlug);
  const [textInput, setTextInput] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canRunWasm = useMemo(
    () => tool?.execution_mode === 'client-wasm' && Boolean(tool.wasm_entry),
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

  async function handleRun() {
    if (!canRunWasm) {
      setErrorMessage('当前工具未启用 WASM 执行。');
      return;
    }

    if (!textInput.trim()) {
      setErrorMessage('请输入文本后再执行。');
      return;
    }

    try {
      setRunning(true);
      setErrorMessage('');
      const output = await runWasmTool(activeTool.wasm_entry!, textInput);
      setResult(output);
    } catch (error) {
      setResult('');
      setErrorMessage(error instanceof Error ? error.message : 'WASM 执行失败');
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
        <button className="tool-button" type="button" onClick={handleRun} disabled={running || !canRunWasm}>
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
        <h2>版本信息</h2>
        <p>version: {activeTool.version}</p>
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
