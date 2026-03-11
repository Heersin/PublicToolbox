import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';
import {
  AFFINE_VALID_A_VALUES,
  BASE64_STANDARD_ALPHABET,
  BASE64_URLSAFE_ALPHABET,
  executeCipher,
  type CipherAlgorithm,
  type CipherDirection,
  type CipherRequest,
} from '../lib/cipher/classicCipher';

type StatusTone = 'idle' | 'success' | 'error';
type Base64Preset = 'standard' | 'urlsafe' | 'custom';

const MAX_INPUT_CHARS = 20000;

function clampInteger(rawValue: string, min: number, max: number): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

export default function CipherPage() {
  const tool = getToolBySlug('cipher');
  const [algorithm, setAlgorithm] = useState<CipherAlgorithm>('caesar');
  const [direction, setDirection] = useState<CipherDirection>('encode');

  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [statusTone, setStatusTone] = useState<StatusTone>('idle');
  const [statusMessage, setStatusMessage] = useState('请选择算法并输入文本后执行。');

  const [caesarShift, setCaesarShift] = useState(3);
  const [vigenereKey, setVigenereKey] = useState('LEMON');
  const [affineA, setAffineA] = useState(5);
  const [affineB, setAffineB] = useState(8);

  const [base64Preset, setBase64Preset] = useState<Base64Preset>('standard');
  const [base64Alphabet, setBase64Alphabet] = useState(BASE64_STANDARD_ALPHABET);
  const [base64PaddingEnabled, setBase64PaddingEnabled] = useState(true);
  const [base64PaddingChar, setBase64PaddingChar] = useState('=');

  const affineAValid = useMemo(
    () => AFFINE_VALID_A_VALUES.includes(affineA as (typeof AFFINE_VALID_A_VALUES)[number]),
    [affineA],
  );

  const runDisabled = useMemo(() => {
    if (algorithm === 'affine' && !affineAValid) {
      return true;
    }
    return inputText.length > MAX_INPUT_CHARS;
  }, [algorithm, affineAValid, inputText.length]);

  function setStatus(message: string, tone: StatusTone) {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function applyBase64Preset(preset: Base64Preset) {
    setBase64Preset(preset);
    if (preset === 'standard') {
      setBase64Alphabet(BASE64_STANDARD_ALPHABET);
    } else if (preset === 'urlsafe') {
      setBase64Alphabet(BASE64_URLSAFE_ALPHABET);
    }
  }

  function buildRequest(): CipherRequest {
    return {
      algorithm,
      direction,
      input: inputText,
      caesarShift,
      vigenereKey,
      affineA,
      affineB,
      base64Options: {
        alphabet64: base64Alphabet,
        paddingEnabled: base64PaddingEnabled,
        paddingChar: base64PaddingChar,
      },
    };
  }

  function handleRun() {
    if (inputText.length > MAX_INPUT_CHARS) {
      setStatus(`输入最多 ${MAX_INPUT_CHARS} 个字符。`, 'error');
      return;
    }

    const result = executeCipher(buildRequest());
    if (result.error) {
      setOutputText('');
      setStatus(result.error, 'error');
      return;
    }

    setOutputText(result.output);
    setStatus('执行完成。', 'success');
  }

  async function copyOutput() {
    if (!navigator.clipboard?.writeText) {
      setStatus('当前浏览器不支持系统剪贴板复制。', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(outputText);
      setStatus('结果已复制。', 'success');
    } catch {
      setStatus('复制失败，请检查浏览器权限。', 'error');
    }
  }

  function clearAll() {
    setInputText('');
    setOutputText('');
    setStatus('已清空输入与输出。', 'idle');
  }

  const toolName = tool?.name ?? '解符';
  const toolDescription = tool?.description ?? '常见古典加密编解码工具，支持 Base64 自定义密码表。';

  return (
    <main className="tool-page cipher-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/cipher</p>
        <h1>{toolName}</h1>
        <p>{toolDescription}</p>
      </header>

      <section className="cipher-shell">
        <div className="cipher-top-row">
          <label className="cipher-field">
            <span>算法</span>
            <select
              className="cipher-select"
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as CipherAlgorithm)}
            >
              <option value="caesar">凯撒</option>
              <option value="rot13">ROT13</option>
              <option value="atbash">Atbash</option>
              <option value="vigenere">维吉尼亚</option>
              <option value="affine">仿射</option>
              <option value="base64">Base64</option>
            </select>
          </label>

          <div className="cipher-direction" role="group" aria-label="方向">
            <button
              type="button"
              className={`cipher-direction-button${direction === 'encode' ? ' active' : ''}`}
              onClick={() => setDirection('encode')}
            >
              编码
            </button>
            <button
              type="button"
              className={`cipher-direction-button${direction === 'decode' ? ' active' : ''}`}
              onClick={() => setDirection('decode')}
            >
              解码
            </button>
          </div>
        </div>

        <div className="cipher-param-grid">
          {algorithm === 'caesar' ? (
            <label className="cipher-field">
              <span>shift (0-25)</span>
              <input
                className="cipher-input"
                type="number"
                min={0}
                max={25}
                value={caesarShift}
                onChange={(event) => setCaesarShift(clampInteger(event.target.value, 0, 25))}
              />
            </label>
          ) : null}

          {algorithm === 'rot13' || algorithm === 'atbash' ? (
            <p className="cipher-param-note">该算法无需额外参数。</p>
          ) : null}

          {algorithm === 'vigenere' ? (
            <label className="cipher-field">
              <span>key (仅字母)</span>
              <input
                className="cipher-input"
                type="text"
                value={vigenereKey}
                onChange={(event) => setVigenereKey(event.target.value)}
                placeholder="例如: LEMON"
                autoComplete="off"
              />
            </label>
          ) : null}

          {algorithm === 'affine' ? (
            <>
              <label className="cipher-field">
                <span>a (与 26 互素)</span>
                <input
                  className="cipher-input"
                  type="number"
                  min={0}
                  max={25}
                  value={affineA}
                  onChange={(event) => setAffineA(clampInteger(event.target.value, 0, 25))}
                />
              </label>

              <label className="cipher-field">
                <span>b (0-25)</span>
                <input
                  className="cipher-input"
                  type="number"
                  min={0}
                  max={25}
                  value={affineB}
                  onChange={(event) => setAffineB(clampInteger(event.target.value, 0, 25))}
                />
              </label>

              <p className={`cipher-affine-hint${affineAValid ? '' : ' is-invalid'}`}>
                {affineAValid
                  ? '参数 a 合法，可执行。'
                  : `参数 a 不合法。允许值：${AFFINE_VALID_A_VALUES.join(', ')}`}
              </p>
            </>
          ) : null}

          {algorithm === 'base64' ? (
            <>
              <label className="cipher-field">
                <span>预设</span>
                <select
                  className="cipher-select"
                  value={base64Preset}
                  onChange={(event) => applyBase64Preset(event.target.value as Base64Preset)}
                >
                  <option value="standard">标准</option>
                  <option value="urlsafe">URL-safe</option>
                  <option value="custom">自定义</option>
                </select>
              </label>

              <label className="cipher-field cipher-field-wide">
                <span>64 字符表</span>
                <input
                  className="cipher-input"
                  type="text"
                  value={base64Alphabet}
                  onChange={(event) => {
                    const next = event.target.value;
                    setBase64Alphabet(next);
                    if (next === BASE64_STANDARD_ALPHABET) {
                      setBase64Preset('standard');
                    } else if (next === BASE64_URLSAFE_ALPHABET) {
                      setBase64Preset('urlsafe');
                    } else {
                      setBase64Preset('custom');
                    }
                  }}
                  autoComplete="off"
                />
              </label>

              <label className="cipher-check">
                <input
                  type="checkbox"
                  checked={base64PaddingEnabled}
                  onChange={(event) => setBase64PaddingEnabled(event.target.checked)}
                />
                启用填充
              </label>

              <label className="cipher-field">
                <span>填充字符</span>
                <input
                  className="cipher-input"
                  type="text"
                  value={base64PaddingChar}
                  onChange={(event) => setBase64PaddingChar(event.target.value)}
                  placeholder="="
                  autoComplete="off"
                />
              </label>
            </>
          ) : null}
        </div>

        <div className="cipher-io-grid">
          <label className="cipher-field">
            <span>输入</span>
            <textarea
              className="tool-textarea cipher-textarea"
              rows={10}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="输入待处理文本"
            />
            <small className="cipher-count">字符数：{inputText.length} / {MAX_INPUT_CHARS}</small>
          </label>

          <label className="cipher-field">
            <span>输出</span>
            <textarea className="tool-textarea cipher-textarea" rows={10} value={outputText} readOnly />
          </label>
        </div>

        <div className="cipher-actions">
          <button className="tool-button" type="button" onClick={handleRun} disabled={runDisabled}>
            执行
          </button>
          <button className="tool-button" type="button" onClick={() => void copyOutput()}>
            复制结果
          </button>
          <button className="tool-button" type="button" onClick={clearAll}>
            清空
          </button>
        </div>

        <p className={`cipher-status is-${statusTone}`}>{statusMessage}</p>
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
