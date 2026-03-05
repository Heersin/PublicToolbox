import { Link, useParams } from 'react-router-dom';
import { getToolBySlug } from '../lib/toolCatalog';

export default function ToolEntryPage() {
  const { toolSlug } = useParams();
  const tool = getToolBySlug(toolSlug);

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

  return (
    <main className="tool-page">
      <header className="tool-header">
        <p className="hero-eyebrow">/{tool.slug}</p>
        <h1>{tool.name}</h1>
        <p>{tool.description}</p>
      </header>

      <section className="tool-panel">
        <h2>输入区</h2>
        <p>输入组件将在后续里程碑按工具执行模式接入。</p>
      </section>

      <section className="tool-panel">
        <h2>执行区</h2>
        <p>当前执行模式：{tool.execution_mode}</p>
      </section>

      <section className="tool-panel">
        <h2>结果区</h2>
        <p>执行结果组件将在 WASM/API 链路完成后启用。</p>
      </section>

      <section className="tool-panel">
        <h2>版本信息</h2>
        <p>version: {tool.version}</p>
      </section>

      <Link to="/" className="tool-link">
        返回总览
      </Link>
    </main>
  );
}
