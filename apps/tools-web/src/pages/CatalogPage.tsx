import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { Link } from 'react-router-dom';
import { getAllTools } from '../lib/toolCatalog';

const tools = getAllTools();
const DRAG_ACTIVATION_PX = 8;
const CLICK_SUPPRESS_MS = 220;

export default function CatalogPage() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panDirectionRef = useRef<0 | -1 | 1>(0);
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    moved: false,
    pointerId: null as number | null,
  });
  const suppressClickUntilRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

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

  const handleWindowPointerMove = useCallback((event: globalThis.PointerEvent) => {
    const viewport = viewportRef.current;
    const state = dragStateRef.current;
    if (!viewport || !state.active || state.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (!state.moved) {
      if (absX < DRAG_ACTIVATION_PX || absX <= absY) {
        return;
      }
      state.moved = true;
      setIsDragging(true);
    }

    event.preventDefault();
    viewport.scrollLeft = state.startScrollLeft - deltaX;
  }, []);

  const handleWindowPointerEnd = useCallback((event: globalThis.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state.active || state.pointerId !== event.pointerId) {
      return;
    }

    const wasMoved = state.moved;
    dragStateRef.current.active = false;
    dragStateRef.current.moved = false;
    dragStateRef.current.pointerId = null;
    setIsDragging(false);
    if (wasMoved) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    }
    window.removeEventListener('pointermove', handleWindowPointerMove);
  }, [handleWindowPointerMove]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  }, [handleWindowPointerMove, handleWindowPointerEnd]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      moved: false,
      pointerId: event.pointerId,
    };
    setIsDragging(false);
    stopEdgePan();
    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', handleWindowPointerEnd, { once: true });
    window.addEventListener('pointercancel', handleWindowPointerEnd, { once: true });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 1) {
      return;
    }

    const canScrollHorizontally = viewport.scrollWidth > viewport.clientWidth;
    if (!canScrollHorizontally) {
      return;
    }

    viewport.scrollLeft += event.deltaY;
    event.preventDefault();
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <main className="catalog-page">
      <header className="catalog-title-wrap">
        <h1 className="catalog-title">百工辑录</h1>
        <div className="huiwen-underline" aria-hidden="true" />
      </header>

      <section className="catalog-rail-shell" aria-label="tool catalog">
        <div className="rope-line" />
        <div className="rope-base" />

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
          onWheel={handleWheel}
          onClickCapture={handleClickCapture}
        >
          <div className="card-rail">
            {tools.map((tool) => (
              tool.external_href ? (
                <a
                  key={tool.id}
                  href={tool.external_href}
                  className="tool-strip-card"
                  aria-label={`进入 ${tool.name}`}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <h2 className="strip-title">{tool.name}</h2>
                  <div className="strip-tags">
                    {tool.tags.slice(0, 3).map((tag) => (
                      <span key={`${tool.id}-${tag}`} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </a>
              ) : (
                <Link
                  key={tool.id}
                  to={`/${tool.slug}`}
                  className="tool-strip-card"
                  aria-label={`进入 ${tool.name}`}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <h2 className="strip-title">{tool.name}</h2>
                  <div className="strip-tags">
                    {tool.tags.slice(0, 3).map((tag) => (
                      <span key={`${tool.id}-${tag}`} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </Link>
              )
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
