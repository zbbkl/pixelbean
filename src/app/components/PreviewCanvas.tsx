import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Pattern } from '../../types';
import { drawGrid } from '../../core/render/drawGrid';
import type { LoadedPalette } from '../../core/palette/types';
import type { HoverCell, SourceImage, ViewState } from '../types';

interface Props {
  pattern: Pattern | null;
  palette: LoadedPalette | null;
  source: SourceImage | null;
  loading: boolean;
  showCodes: boolean;
  showGridLines: boolean;
  onToggleCodes: (value: boolean) => void;
  onToggleGrid: (value: boolean) => void;
  hover: HoverCell | null;
  view: ViewState;
  onHover: (hover: HoverCell | null) => void;
  onView: (patch: Partial<ViewState>) => void;
}

const PADDING = 40;
const MIN_ZOOM = 1;
const MAX_ZOOM = 96;

export function PreviewCanvas({
  pattern,
  palette,
  source,
  loading,
  showCodes,
  showGridLines,
  onToggleCodes,
  onToggleGrid,
  hover,
  view,
  onHover,
  onView
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState({ width: 600, height: 420 });

  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom));
  const cssWidth = pattern ? Math.ceil(pattern.width * zoom + PADDING * 2) : contentSize.width;
  const cssHeight = pattern ? Math.ceil(pattern.height * zoom + PADDING * 2) : contentSize.height;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      setContentSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern || !palette) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = zoom * dpr;
    drawGrid(ctx, pattern, palette, {
      cellPx,
      offsetX: (PADDING + view.panX) * dpr,
      offsetY: (PADDING + view.panY) * dpr,
      showCodes,
      showGridLines,
      hover
    });
  }, [pattern, palette, zoom, view.panX, view.panY, showCodes, showGridLines, hover, cssWidth, cssHeight]);

  const pointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const hitCell = (event: React.PointerEvent): HoverCell | null => {
    if (!pattern) return null;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const gx = Math.floor((x - PADDING - view.panX) / zoom);
    const gy = Math.floor((y - PADDING - view.panY) / zoom);
    if (gx < 0 || gy < 0 || gx >= pattern.width || gy >= pattern.height) return null;
    return { x: gx, y: gy };
  };

  const fit = () => {
    if (!pattern) return;
    const pad = 16;
    const available = Math.max(8, contentSize.width - pad * 2);
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(available / Math.max(pattern.width, 1))));
    onView({ zoom: newZoom, panX: 0, panY: 0 });
  };

  const hoverIndex = hover && pattern ? pattern.cells[hover.y * pattern.width + hover.x] : -1;
  const hoverColor = hoverIndex >= 0 && palette ? palette.solids[hoverIndex] : null;

  return (
    <section className="preview-pane">
      <div className="pane-toolbar">
        <span className="pane-title">图纸</span>
        <div className="tool-group">
          <button className="tool-button" onClick={() => onView({ zoom: zoom * 0.85 })} aria-label="缩小">−</button>
          <span className="zoom-label">{Math.round(zoom)} px</span>
          <button className="tool-button" onClick={() => onView({ zoom: zoom * 1.18 })} aria-label="放大">＋</button>
          <button className="tool-button" onClick={fit}>适应</button>
        </div>
        <div className="tool-group">
          <button
            className={`tool-toggle ${showCodes ? 'active' : ''}`}
            onClick={() => onToggleCodes(!showCodes)}
          >
            色号
          </button>
          <button
            className={`tool-toggle ${showGridLines ? 'active' : ''}`}
            onClick={() => onToggleGrid(!showGridLines)}
          >
            格线
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="canvas-scroll"
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          pointerRef.current = { x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pointer = pointerRef.current;
          if (pointer && (event.buttons & 1 || event.buttons & 4)) {
            const dx = event.clientX - pointer.x;
            const dy = event.clientY - pointer.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
            onView({ panX: view.panX + dx, panY: view.panY + dy });
            pointer.x = event.clientX;
            pointer.y = event.clientY;
          } else {
            onHover(hitCell(event));
          }
        }}
        onPointerUp={() => {
          pointerRef.current = null;
        }}
        onPointerLeave={() => {
          pointerRef.current = null;
          onHover(null);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          onView({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor)) });
        }}
        onDoubleClick={fit}
      >
        <canvas ref={canvasRef} className="preview-canvas" />
        {hoverColor && (
          <div className="hover-bar">
            <span
              className="swatch"
              style={{ background: hoverColor.hex ?? '#fff' }}
            />
            <strong>{pattern?.codes[hoverIndex]}</strong>
            {hoverColor.name && <span>{hoverColor.name}</span>}
            <span>{hoverColor.hex ?? '透明'}</span>
          </div>
        )}
        {loading && <div className="converting-badge">转换中</div>}
      </div>
      <div className="source-foot">
        {source ? (
          <span>{source.name} · 原图 {source.naturalWidth} × {source.naturalHeight}</span>
        ) : (
          <span>未载入图片</span>
        )}
        {pattern && !loading && (
          <span>网格 {pattern.width} × {pattern.height} · {pattern.cells.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0)} 格</span>
        )}
      </div>
    </section>
  );
}
