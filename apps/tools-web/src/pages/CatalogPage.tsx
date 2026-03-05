import { Link } from 'react-router-dom';
import { getAllTools } from '../lib/toolCatalog';

const tools = getAllTools();

export default function CatalogPage() {
  return (
    <main className="catalog-page">
      <header className="hero">
        <p className="hero-eyebrow">Tools Subsite</p>
        <h1>书简工具集</h1>
        <p className="hero-text">黑白平面风格的工具总览页，按子路由进入各工具。</p>
      </header>

      <section className="card-grid" aria-label="tool catalog">
        {tools.map((tool) => (
          <article key={tool.id} className="tool-card">
            <div className="tool-card-head">
              <h2>{tool.name}</h2>
              <span className="mode-chip">{tool.execution_mode}</span>
            </div>
            <p className="tool-description">{tool.description}</p>
            <p className="tool-slug">/{tool.slug}</p>
            <div className="tool-tags">
              {tool.tags.map((tag) => (
                <span key={`${tool.id}-${tag}`} className="tag">
                  {tag}
                </span>
              ))}
            </div>
            <Link to={`/${tool.slug}`} className="tool-link">
              进入工具
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
