import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { getAllTools } from '../lib/toolCatalog';

const tools = getAllTools();

export default function CatalogPage() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panDirectionRef = useRef<0 | -1 | 1>(0);
  const dragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  function panStep() {
    const viewport = viewportRef.current;
    if (!viewport || panDirectionRef.current === 0) {
      return;
    }

    viewport.scrollLeft += panDirectionRef.current * 12;
    animationFrameRef.current = requestAnimationFrame(panStep);
  }

  function startEdgePan(direction: -1 | 1) {
    panDirectionRef.current = direction;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(panStep);
  }

  function stopEdgePan() {
    panDirectionRef.current = 0;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      moved: false,
    };
    setIsDragging(true);
    stopEdgePan();
    viewport.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const state = dragStateRef.current;
    if (!viewport || !state.active) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    if (Math.abs(deltaX) > 4) {
      state.moved = true;
    }

    viewport.scrollLeft = state.startScrollLeft - deltaX;
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || !dragStateRef.current.active) {
      return;
    }

    dragStateRef.current.active = false;
    setIsDragging(false);
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (dragStateRef.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      dragStateRef.current.moved = false;
    }
  }

  return (
    <main className="catalog-page">
      <header className="hero">
        <p className="hero-eyebrow">Tools Subsite</p>
        <h1>书简工具集</h1>
        <p className="hero-text">将鼠标移动到左右边缘热区，或直接拖拽书简卡片，浏览更多工具。</p>
      </header>

      <section className="catalog-rail-shell" aria-label="tool catalog">
        <div className="rail-guide rail-guide-top" />
        <div className="rail-guide rail-guide-bottom" />

        <button
          type="button"
          className="edge-zone edge-zone-left"
          aria-label="向左查看工具"
          onMouseEnter={() => startEdgePan(-1)}
          onMouseLeave={stopEdgePan}
          onFocus={() => startEdgePan(-1)}
          onBlur={stopEdgePan}
        />

        <div
          ref={viewportRef}
          className={`card-viewport${isDragging ? ' is-dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerLeave={(event) => {
            if (!dragStateRef.current.active) {
              stopEdgePan();
            }
            handlePointerEnd(event);
          }}
          onClickCapture={handleClickCapture}
        >
          <div className="card-rail">
            {tools.map((tool) => (
              <article key={tool.id} className="tool-strip-card">
                <p className="strip-mode">{tool.execution_mode}</p>
                <h2 className="strip-title">{tool.name}</h2>
                <p className="strip-route">/{tool.slug}</p>
                <div className="strip-tags">
                  {tool.tags.slice(0, 3).map((tag) => (
                    <span key={`${tool.id}-${tag}`} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <Link to={`/${tool.slug}`} className="tool-link strip-link">
                  进入
                </Link>
              </article>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="edge-zone edge-zone-right"
          aria-label="向右查看工具"
          onMouseEnter={() => startEdgePan(1)}
          onMouseLeave={stopEdgePan}
          onFocus={() => startEdgePan(1)}
          onBlur={stopEdgePan}
        />
      </section>
    </main>
  );
}
