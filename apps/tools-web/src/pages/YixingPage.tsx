import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';
import {
  ImageConvertApiError,
  convertImage,
  type TargetImageFormat,
} from '../lib/runtime/imageConvertRuntime';

type StatusTone = 'idle' | 'success' | 'error';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function supportedImage(file: File): boolean {
  if (file.type && ACCEPTED_MIME.has(file.type.toLowerCase())) {
    return true;
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  return Boolean(extension && ACCEPTED_EXTENSIONS.has(extension));
}

function mapConvertError(error: unknown): string {
  if (error instanceof ImageConvertApiError) {
    switch (error.code) {
      case 'REQUEST_UNREACHABLE':
        return '无法连接易形 API。开发模式请先启动：cargo run -p tools-api';
      case 'REQUEST_URL_INVALID':
        return '当前访问地址不受支持，请用标准 http/https 域名访问。';
      case 'REQUEST_TIMEOUT':
        return '转换超时，请换小图或稍后重试。';
      case 'FILE_REQUIRED':
        return '请先选择要转换的图片。';
      case 'TARGET_FORMAT_REQUIRED':
        return '请选择目标格式。';
      case 'UNSUPPORTED_TARGET_FORMAT':
        return '目标格式仅支持 png / jpg / webp。';
      case 'UNSUPPORTED_INPUT_FORMAT':
        return '输入格式不受支持，仅支持 png / jpg / jpeg / webp。';
      case 'FILE_TOO_LARGE':
        return `文件超过 ${formatBytes(MAX_FILE_BYTES)}，请压缩后重试。`;
      case 'INVALID_BACKGROUND':
        return '背景色格式无效，需要 #RRGGBB。';
      case 'INVALID_IMAGE_DATA':
        return '图片数据无法识别，请确认文件未损坏。';
      case 'INVALID_MULTIPART':
        return '上传数据格式错误，请重新选择文件后再试。';
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }
  return '图片转换失败。';
}

export default function YixingPage() {
  const tool = getToolBySlug('yixing');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [targetFormat, setTargetFormat] = useState<TargetImageFormat>('png');
  const [background, setBackground] = useState('#ffffff');
  const [statusTone, setStatusTone] = useState<StatusTone>('idle');
  const [statusMessage, setStatusMessage] = useState('上传图片后选择目标格式并执行转换。');
  const [running, setRunning] = useState(false);
  const [lastDownloadName, setLastDownloadName] = useState('');

  const showBackgroundPicker = targetFormat === 'jpg';
  const selectedTypeLabel = selectedFile?.type || 'unknown';
  const canConvert = useMemo(() => Boolean(selectedFile) && !running, [selectedFile, running]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  function setStatus(message: string, tone: StatusTone = 'idle') {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  function handlePickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      setStatus('请选择图片文件。', 'idle');
      return;
    }

    if (!supportedImage(file)) {
      setSelectedFile(null);
      setStatus('文件格式不支持，仅接受 png / jpg / jpeg / webp。', 'error');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      setStatus(`文件超过 ${formatBytes(MAX_FILE_BYTES)}。`, 'error');
      return;
    }

    setSelectedFile(file);
    setStatus(`已选择 ${file.name}，可开始转换。`, 'success');
  }

  async function handleConvert() {
    if (!selectedFile) {
      setStatus('请先选择图片。', 'error');
      return;
    }

    setRunning(true);
    try {
      const result = await convertImage({
        file: selectedFile,
        targetFormat,
        background: showBackgroundPicker ? background : undefined,
      });

      const downloadUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = result.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

      setLastDownloadName(result.fileName);
      setStatus(`转换成功，已下载 ${result.fileName}。`, 'success');
    } catch (error) {
      setStatus(mapConvertError(error), 'error');
    } finally {
      setRunning(false);
    }
  }

  const toolName = tool?.name ?? '易形';
  const toolDescription = tool?.description ?? 'PNG / JPG / WebP 单图互转工具。';

  return (
    <main className="tool-page yixing-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/yixing</p>
        <h1>{toolName}</h1>
        <p>{toolDescription}</p>
      </header>

      <section className="yixing-shell">
        <div className="yixing-controls">
          <label className="yixing-field yixing-file-field">
            <span>上传图片</span>
            <input
              className="yixing-input"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              onChange={handlePickFile}
            />
          </label>

          <label className="yixing-field">
            <span>目标格式</span>
            <select
              className="yixing-select"
              value={targetFormat}
              onChange={(event) => setTargetFormat(event.target.value as TargetImageFormat)}
            >
              <option value="png">png</option>
              <option value="jpg">jpg</option>
              <option value="webp">webp</option>
            </select>
          </label>

          {showBackgroundPicker ? (
            <label className="yixing-field yixing-color-field">
              <span>透明转 JPG 底色</span>
              <div className="yixing-color-control">
                <input
                  className="yixing-color-input"
                  type="color"
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                />
                <code>{background}</code>
              </div>
            </label>
          ) : null}
        </div>

        <div className="yixing-meta">
          <p>输入格式：{selectedFile ? selectedTypeLabel : '未选择'}</p>
          <p>文件大小：{selectedFile ? formatBytes(selectedFile.size) : '-'}</p>
          <p>上传上限：{formatBytes(MAX_FILE_BYTES)}</p>
        </div>

        <div className="yixing-preview">
          {previewUrl ? (
            <img src={previewUrl} alt="待转换预览" />
          ) : (
            <p>选择图片后会在这里显示预览。</p>
          )}
        </div>

        <div className="yixing-actions">
          <button className="tool-button" type="button" onClick={handleConvert} disabled={!canConvert}>
            {running ? '转换中...' : '转换并下载'}
          </button>
        </div>

        <p className={`yixing-status is-${statusTone}`}>{statusMessage}</p>
        {lastDownloadName ? <p className="yixing-download">最近导出：{lastDownloadName}</p> : null}
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
