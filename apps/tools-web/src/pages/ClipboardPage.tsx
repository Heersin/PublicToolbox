import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';
import {
  ClipboardApiError,
  clearClipboard,
  getClipboard,
  saveClipboard,
} from '../lib/runtime/clipboardRuntime';

const MAX_INPUT_CHARS = 200000;
const MAX_PASSWORD_CHARS = 20;
const PHRASE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const LAST_PHRASE_KEY = 'toolbox.clipboard.lastPhrase';
const DRAFT_PREFIX = 'toolbox.clipboard.draft.';

type StatusTone = 'idle' | 'success' | 'error';

function normalizePhrase(value: string): string {
  return value.trim().toLowerCase();
}

function draftKey(phrase: string): string {
  return `${DRAFT_PREFIX}${phrase}`;
}

function buildShareUrl(phrase: string): string {
  const safePath = `/clipboard/${encodeURIComponent(phrase)}`;
  return `${window.location.origin}${safePath}`;
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function formatUpdatedAt(updatedAt: string): string {
  if (!updatedAt) {
    return '尚未保存';
  }

  const asNumber = Number(updatedAt);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return updatedAt;
  }

  return new Date(asNumber * 1000).toLocaleString();
}

function validatePhrase(phrase: string): string | null {
  if (!PHRASE_PATTERN.test(phrase)) {
    return '短语格式无效，需为 3-32 位字母/数字/下划线/短横线。';
  }
  return null;
}

function mapApiError(error: unknown): string {
  if (error instanceof ClipboardApiError) {
    switch (error.code) {
      case 'REQUEST_UNREACHABLE':
        return '无法连接云帖 API。开发模式请先启动：cargo run -p tools-api';
      case 'REQUEST_URL_INVALID':
        return '当前访问地址不受支持，请用常规 http/https 域名打开云帖。';
      case 'AUTH_REQUIRED':
        return '该短语已设口令，请输入口令后访问。';
      case 'AUTH_FAILED':
        return '口令错误，请重试。';
      case 'CLIPBOARD_NOT_FOUND':
        return '未找到该短语对应的云帖。';
      case 'INVALID_PHRASE':
        return '短语格式无效。';
      case 'INVALID_PASSWORD':
        return '口令长度需在 20 位以内。';
      case 'INVALID_INPUT':
        return `内容最多 ${MAX_INPUT_CHARS} 个字符。`;
      case 'DB_ERROR':
        return '服务端存储异常，请稍后再试。';
      case 'REQUEST_TIMEOUT':
        return '请求超时，请稍后再试。';
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    if (error.message.includes('did not match the expected pattern')) {
      return '当前访问地址不受支持，请用常规 http/https 域名打开云帖。';
    }
    return error.message;
  }
  return '请求失败。';
}

function safelyReadLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safelyWriteLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore local storage failures
  }
}

function safelyRemoveLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore local storage failures
  }
}

export default function ClipboardPage() {
  const { phrase: routePhrase } = useParams();
  const tool = getToolBySlug('clipboard');
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [activePhrase, setActivePhrase] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [exists, setExists] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [statusMessage, setStatusMessage] = useState('输入短语后读取或保存。');
  const [statusTone, setStatusTone] = useState<StatusTone>('idle');
  const [running, setRunning] = useState(false);

  const normalizedPhrase = useMemo(() => normalizePhrase(phraseInput), [phraseInput]);
  const inputCharCount = useMemo(() => countCharacters(textInput), [textInput]);
  const effectivePassword = passwordEnabled ? passwordInput : '';
  const shareUrl = useMemo(
    () => (validatePhrase(normalizedPhrase) ? '' : buildShareUrl(normalizedPhrase)),
    [normalizedPhrase],
  );

  function setStatus(message: string, tone: StatusTone = 'idle') {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  async function loadPhrase(targetPhrase?: string) {
    const phrase = normalizePhrase(targetPhrase ?? phraseInput);
    const phraseError = validatePhrase(phrase);
    if (phraseError) {
      setStatus(phraseError, 'error');
      return;
    }

    if (effectivePassword.length > MAX_PASSWORD_CHARS) {
      setStatus(`口令最多 ${MAX_PASSWORD_CHARS} 位。`, 'error');
      return;
    }
    if (passwordEnabled && !effectivePassword) {
      setStatus('已启用口令，请先输入口令。', 'error');
      return;
    }

    setRunning(true);
    try {
      const data = await getClipboard(phrase, effectivePassword);
      setPhraseInput(phrase);
      setActivePhrase(phrase);
      setHasPassword(data.has_password);
      setExists(data.exists);
      setUpdatedAt(data.updated_at);

      safelyWriteLocalStorage(LAST_PHRASE_KEY, phrase);
      if (data.exists) {
        setTextInput(data.text);
        setStatus('已读取云帖内容。', 'success');
      } else {
        const draft = safelyReadLocalStorage(draftKey(phrase));
        setTextInput(draft ?? '');
        setStatus(draft ? '该短语暂无云端内容，已恢复本地草稿。' : '该短语暂无内容，可直接编辑并保存。');
      }
    } catch (error) {
      if (error instanceof ClipboardApiError && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_FAILED')) {
        setPasswordEnabled(true);
      }
      setStatus(mapApiError(error), 'error');
    } finally {
      setRunning(false);
    }
  }

  async function saveCurrent() {
    const phraseError = validatePhrase(normalizedPhrase);
    if (phraseError) {
      setStatus(phraseError, 'error');
      return;
    }

    if (effectivePassword.length > MAX_PASSWORD_CHARS) {
      setStatus(`口令最多 ${MAX_PASSWORD_CHARS} 位。`, 'error');
      return;
    }
    if (passwordEnabled && !effectivePassword) {
      setStatus('已启用口令，请先输入口令。', 'error');
      return;
    }

    if (inputCharCount > MAX_INPUT_CHARS) {
      setStatus(`内容最多 ${MAX_INPUT_CHARS} 个字符。`, 'error');
      return;
    }

    setRunning(true);
    try {
      const data = await saveClipboard(normalizedPhrase, effectivePassword, textInput);
      setPhraseInput(data.phrase);
      setActivePhrase(data.phrase);
      setHasPassword(data.has_password);
      setExists(true);
      setUpdatedAt(data.updated_at);
      safelyWriteLocalStorage(LAST_PHRASE_KEY, data.phrase);
      setStatus('已保存到云帖。', 'success');
    } catch (error) {
      if (error instanceof ClipboardApiError && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_FAILED')) {
        setPasswordEnabled(true);
      }
      setStatus(mapApiError(error), 'error');
    } finally {
      setRunning(false);
    }
  }

  async function clearCurrent() {
    const phraseError = validatePhrase(normalizedPhrase);
    if (phraseError) {
      setStatus(phraseError, 'error');
      return;
    }

    if (effectivePassword.length > MAX_PASSWORD_CHARS) {
      setStatus(`口令最多 ${MAX_PASSWORD_CHARS} 位。`, 'error');
      return;
    }
    if (passwordEnabled && !effectivePassword) {
      setStatus('已启用口令，请先输入口令。', 'error');
      return;
    }

    setRunning(true);
    try {
      const data = await clearClipboard(normalizedPhrase, effectivePassword);
      setPhraseInput(data.phrase);
      setActivePhrase(data.phrase);
      setHasPassword(data.has_password);
      setExists(true);
      setUpdatedAt(data.updated_at);
      setTextInput('');
      safelyRemoveLocalStorage(draftKey(data.phrase));
      setStatus('云帖内容已清空。', 'success');
    } catch (error) {
      if (error instanceof ClipboardApiError && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_FAILED')) {
        setPasswordEnabled(true);
      }
      setStatus(mapApiError(error), 'error');
    } finally {
      setRunning(false);
    }
  }

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
      if (countCharacters(incoming) > MAX_INPUT_CHARS) {
        setStatus(`粘贴内容超过 ${MAX_INPUT_CHARS} 字符，已拒绝。`, 'error');
        return;
      }
      setTextInput(incoming);
      setStatus('已从系统剪贴板粘贴内容。', 'success');
    } catch {
      setStatus('粘贴失败，请检查浏览器权限。', 'error');
    }
  }

  async function sharePhraseLink() {
    const phraseError = validatePhrase(normalizedPhrase);
    if (phraseError) {
      setStatus(phraseError, 'error');
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setStatus('分享链接已生成，请手动复制。');
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus('分享链接已复制（不包含口令）。', 'success');
    } catch {
      setStatus('复制分享链接失败，请手动复制。', 'error');
    }
  }

  useEffect(() => {
    if (routePhrase) {
      void loadPhrase(routePhrase);
      return;
    }

    const lastPhrase = safelyReadLocalStorage(LAST_PHRASE_KEY);
    if (lastPhrase) {
      setPhraseInput(lastPhrase);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePhrase]);

  useEffect(() => {
    if (!activePhrase) {
      return;
    }

    const handle = window.setTimeout(() => {
      const key = draftKey(activePhrase);
      if (!textInput) {
        safelyRemoveLocalStorage(key);
        return;
      }
      safelyWriteLocalStorage(key, textInput);
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [activePhrase, textInput]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();
      if (running) {
        return;
      }
      void saveCurrent();
    }

    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
    };
  });

  const toolName = tool?.name ?? '云帖';
  const toolDescription = tool?.description ?? '短语分区 + 可选口令的在线剪贴板。';

  return (
    <main className="tool-page clipboard-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/clipboard</p>
        <h1>{toolName}</h1>
        <p>{toolDescription}</p>
      </header>

      <section className="clipboard-shell">
        <div className="clipboard-access-grid">
          <label className="clipboard-field">
            <span>短语</span>
            <input
              className="clipboard-input"
              value={phraseInput}
              onChange={(event) => setPhraseInput(event.target.value)}
              placeholder="例如: team_notes"
              autoComplete="off"
            />
          </label>

          <label className="clipboard-check">
            <input
              type="checkbox"
              checked={passwordEnabled}
              onChange={(event) => {
                setPasswordEnabled(event.target.checked);
                if (!event.target.checked) {
                  setPasswordInput('');
                }
              }}
            />
            启用口令
          </label>

          {passwordEnabled ? (
            <label className="clipboard-field">
              <span>口令</span>
              <input
                className="clipboard-input"
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder="最多 20 位"
                autoComplete="off"
              />
            </label>
          ) : null}
        </div>

        <div className="clipboard-meta">
          <p>字符数：{inputCharCount} / {MAX_INPUT_CHARS}</p>
          <p>短语状态：{exists ? '已存在' : '未创建'}</p>
          <p>口令保护：{hasPassword ? '已启用' : '未启用'}</p>
          <p>最近更新：{formatUpdatedAt(updatedAt)}</p>
        </div>

        <textarea
          value={textInput}
          onChange={(event) => {
            if (countCharacters(event.target.value) > MAX_INPUT_CHARS) {
              setStatus(`内容最多 ${MAX_INPUT_CHARS} 个字符。`, 'error');
              return;
            }
            setTextInput(event.target.value);
          }}
          rows={16}
          className="tool-textarea clipboard-textarea"
          placeholder="在这里输入要保存到云帖的文本..."
        />

        <div className="clipboard-actions">
          <button className="tool-button clipboard-button" type="button" disabled={running} onClick={() => void loadPhrase()}>
            {running ? '处理中...' : '读取'}
          </button>
          <button className="tool-button clipboard-button" type="button" disabled={running} onClick={() => void saveCurrent()}>
            保存
          </button>
          <button className="tool-button clipboard-button" type="button" disabled={running} onClick={() => void clearCurrent()}>
            清空
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={() => void copyCurrentText()}>
            复制
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={() => void pasteFromSystem()}>
            粘贴
          </button>
          <button className="tool-button clipboard-button" type="button" onClick={() => void sharePhraseLink()}>
            分享短语链接
          </button>
        </div>

        {shareUrl ? (
          <div className="clipboard-share-box">
            <h2>分享链接（不含口令）</h2>
            <input className="clipboard-share-input" type="text" readOnly value={shareUrl} />
          </div>
        ) : null}

        <p className={`clipboard-status is-${statusTone}`}>{statusMessage}</p>
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
