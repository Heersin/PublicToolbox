import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ToolManifest } from '../generated/tool-manifests';
import { getToolBySlug } from '../lib/toolCatalog';
import { runServerTool } from '../lib/runtime/serverRuntime';
import { runWasmTool } from '../lib/runtime/wasmRuntime';

const MAX_INPUT_CHARS = 20000;
const MAX_WASM_INPUT_CHARS = 5000;
const CLIPBOARD_STORAGE_KEY = 'toolbox.clipboard.v1';
const CLIPBOARD_HASH_KEY = 'clip';

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

function encodeToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeFromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readSharedTextFromHash(): string | null {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const encoded = params.get(CLIPBOARD_HASH_KEY);
  if (!encoded) {
    return null;
  }

  return decodeFromBase64Url(encoded);
}

function buildShareUrl(text: string): string {
  const encoded = encodeToBase64Url(text);
  const nextHash = `${CLIPBOARD_HASH_KEY}=${encoded}`;
  window.history.replaceState(null, '', `#${nextHash}`);
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${nextHash}`;
}

type StatusTone = 'idle' | 'success' | 'error';

function ClipboardToolPage({ activeTool }: { activeTool: ToolManifest }) {
  const [textInput, setTextInput] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [statusTone, setStatusTone] = useState<StatusTone>('idle');
  const [statusMessage, setStatusMessage] = useState('已就绪。支持本地保存与链接分享。');

  function setStatus(message: string, tone: StatusTone = 'idle') {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  useEffect(() => {
    let loadedFromShare = false;

    try {
      const sharedText = readSharedTextFromHash();
      if (sharedText !== null) {
        if (sharedText.length > MAX_INPUT_CHARS) {
          setStatus(`分享内容超过 ${MAX_INPUT_CHARS} 字符，已回退到本地草稿。`, 'error');
        } else {
          setTextInput(sharedText);
          setStatus('已从分享链接恢复内容。', 'success');
          loadedFromShare = true;
        }
      }
    } catch {
      setStatus('分享链接无效，已回退到本地草稿。', 'error');
    }

    if (loadedFromShare) {
      return;
    }

    try {
      const localDraft = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
      if (localDraft) {
        setTextInput(localDraft);
      }
    } catch {
      setStatus('本地存储不可用，刷新后内容可能丢失。', 'error');
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        if (!textInput) {
          window.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, textInput);
      } catch {
        setStatus('本地存储失败，请及时复制备份。', 'error');
      }
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [textInput]);

  async function copyCurrentText() {
    if (!navigator.clipboard?.writeText) {
      setStatus('当前浏览器不支持系统剪贴板复制，请手动复制。', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(textInput);
      setStatus('内容已复制到系统剪贴板。', 'success');
    } catch {
      setStatus('复制失败，请检查浏览器权限。', 'error');
    }
  }

  async function pasteFromSystem() {
    if (!navigator.clipboard?.readText) {
      setStatus('当前浏览器不支持系统剪贴板粘贴，请手动粘贴。', 'error');
      return;
    }

    try {
      const incoming = await navigator.clipboard.readText();
      if (incoming.length > MAX_INPUT_CHARS) {
        setStatus(`粘贴内容超过 ${MAX_INPUT_CHARS} 字符，已拒绝。`, 'error');
        return;
      }
      setTextInput(incoming);
      setStatus('已从系统剪贴板粘贴内容。', 'success');
    } catch {
      setStatus('粘贴失败，请检查浏览器权限。', 'error');
    }
  }

  function clearClipboard() {
    setTextInput('');
    setShareUrl('');
    try {
      window.localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } catch {
      // no-op
    }
    setStatus('内容已清空。', 'success');
  }

  async function shareByUrl() {
    if (!textInput.trim()) {
      setStatus('请输入内容后再生成分享链接。', 'error');
      return;
    }

    try {
      const url = buildShareUrl(textInput);
      setShareUrl(url);

      if (!navigator.clipboard?.writeText) {
        setStatus('分享链接已生成，请手动复制下方链接。', 'error');
        return;
      }

      await navigator.clipboard.writeText(url);
      setStatus('分享链接已复制。', 'success');
    } catch {
      setStatus('生成分享链接失败。', 'error');
    }
  }

  function downloadAsTxt() {
    const blob = new Blob([textInput], { type: 'text/plain;charset=utf-8' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `toolbox-clipboard-${stamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    setStatus('已下载 txt 文件。', 'success');
  }

  function handleTextChange(nextText: string) {
    if (nextText.length > MAX_INPUT_CHARS) {
      setStatus(`最多输入 ${MAX_INPUT_CHARS} 个字符。`, 'error');
      return;
    }
    setTextInput(nextText);
    if (statusTone === 'error') {
      setStatus('已更新内容。');
    }
  }

  return (
    <main className="tool-page clipboard-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/{activeTool.slug}</p>
        <h1>{activeTool.name}</h1>
        <p>{activeTool.description}</p>
      </header>

      <section className="clipboard-shell">
        <div className="clipboard-meta">
          <p>字符数：{textInput.length} / {MAX_INPUT_CHARS}</p>
          <p>本地自动保存：已启用</p>
        </div>

        <textarea
          value={textInput}
          onChange={(event) => handleTextChange(event.target.value)}
          rows={16}
          className="tool-textarea clipboard-textarea"
          placeholder="在这里输入或粘贴文本..."
        />

        <div className="clipboard-actions">
          <button className="tool-button clipboard-button" type="button" onClick={copyCurrentText}>
            复制
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={pasteFromSystem}>
            粘贴
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={shareByUrl}>
            分享链接
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={downloadAsTxt}>
            下载 .txt
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={clearClipboard}>
            清空
          </button>
        </div>

        {shareUrl ? (
          <div className="clipboard-share-box">
            <h2>分享链接</h2>
            <input className="clipboard-share-input" type="text" readOnly value={shareUrl} />
          </div>
        ) : null}

        <p className={`clipboard-status is-${statusTone}`}>{statusMessage}</p>
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

  if (activeTool.slug === 'clipboard') {
    return <ClipboardToolPage activeTool={activeTool} />;
  }

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
