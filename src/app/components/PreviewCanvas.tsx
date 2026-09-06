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
  fullscreen?: boolean;
  showCodes: boolean;
  showGridLines: boolean;
  onToggleCodes: (value: boolean) => void;
  onToggleGrid: (value: boolean) => void;
  onFullscreen?: () => void;
  onCloseFullscreen?: () => void;
  hover: HoverCell | null;
  view: ViewState;
  onHover: (hover: HoverCell | null) => void;
  onView: (patch: Partial<ViewState>) => void;
}

const PADDING = 40;
const MIN_ZOOM = 1;
const MAX_ZOOM = 96;

interface PointerPos {
  x: number;
  y: number;
}

export function PreviewCanvas({
  pattern,
  palette,
  source,
  loading,
  fullscreen = false,
  showCodes,
  showGridLines,
  onToggleCodes,
  onToggleGrid,
  onFullscreen,
  onCloseFullscreen,
  hover,
  view,
  onHover,
  onView
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState({ width: 600, height: 420 });
  const pointersRef = useRef<Map<number, PointerPos>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean } | null>(null);
  const fittedZoomRef = useRef(8);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

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

  const fit = () => {
    if (!pattern) return;
    const pad = 16;
    const availableW = Math.max(8, contentSize.width - pad * 2);
    const availableH = Math.max(8, contentSize.height - pad * 2);
    const scale = Math.min(
      availableW / Math.max(pattern.width, 1),
      availableH / Math.max(pattern.height, 1)
    );
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(scale)));
    fittedZoomRef.current = newZoom;
    onView({ zoom: newZoom, panX: 0, panY: 0 });
  };

  useEffect(() => {
    if (!pattern || contentSize.width < 1) return;
    const timer = window.setTimeout(fit, 40);
    return () => window.clearTimeout(timer);
  }, [pattern?.width, pattern?.height, contentSize.width, contentSize.height]);

  const zoomBy = (factor: number) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    onView({ zoom: next });
  };

  const hitCellAtClient = (clientX: number, clientY: number): HoverCell | null => {
    if (!pattern) return null;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const gx = Math.floor((x - PADDING - view.panX) / zoom);
    const gy = Math.floor((y - PADDING - view.panY) / zoom);
    if (gx < 0 || gy < 0 || gx >= pattern.width || gy >= pattern.height) return null;
    return { x: gx, y: gy };
  };

  const toggleDoubleZoom = (clientX: number, clientY: number) => {
    if (!pattern) return;
    const nearFit = fittedZoomRef.current > 0 && zoom <= fittedZoomRef.current * 1.05;
    if (!nearFit) {
      fit();
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    const localX = rect ? clientX - rect.left : 0;
    const localY = rect ? clientY - rect.top : 0;
    const hit = hitCellAtClient(clientX, clientY);
    const next = Math.min(MAX_ZOOM, zoom * 2);
    const panX = hit ? localX - PADDING - (hit.x + 0.5) * next : view.panX;
    const panY = hit ? localY - PADDING - (hit.y + 0.5) * next : view.panY;
    onView({ zoom: next, panX, panY });
  };

  const handleTap = (clientX: number, clientY: number) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.time < 350 && Math.hypot(clientX - last.x, clientY - last.y) < 32) {
      lastTapRef.current = null;
      toggleDoubleZoom(clientX, clientY);
      return;
    }
    lastTapRef.current = { time: now, x: clientX, y: clientY };
    onHover(hitCellAtClient(clientX, clientY));
  };

  const pointerDistance = () => {
    const pointers = [...pointersRef.current.values()];
    if (pointers.length < 2) return null;
    return {
      distance: Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y),
      centerX: (pointers[0].x + pointers[1].x) / 2,
      centerY: (pointers[0].y + pointers[1].y) / 2
    };
  };

  const updatePinch = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const measured = pointerDistance();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!gesture || !measured || !rect) return;
    if (Math.abs(measured.distance - gesture.startDist) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    const ratio = measured.distance / Math.max(1, gesture.startDist);
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.startZoom * ratio));
    const localCenterX = measured.centerX - rect.left;
    const localCenterY = measured.centerY - rect.top;
    const gx = (localCenterX - PADDING - gesture.startPanX) / Math.max(1, gesture.startZoom);
    const gy = (localCenterY - PADDING - gesture.startPanY) / Math.max(1, gesture.startZoom);
    onView({
      zoom: nextZoom,
      panX: localCenterX - PADDING - gx * nextZoom,
      panY: localCenterY - PADDING - gy * nextZoom
    });
  };

  const hoverIndex = hover && pattern ? pattern.cells[hover.y * pattern.width + hover.x] : -1;
  const hoverColor = hoverIndex >= 0 && palette ? palette.solids[hoverIndex] : null;

  return (
    <section className={`preview-pane ${fullscreen ? 'fullscreen-preview' : ''}`}>
      <div className="pane-toolbar">
        <span className="pane-title">{fullscreen ? '全屏图纸' : '图纸'}</span>
        <div className="tool-group">
          <button className="tool-button" onClick={() => zoomBy(0.8)} aria-label="缩小">−</button>
          <span className="zoom-label">{Math.round(zoom)} px</span>
          <button className="tool-button" onClick={() => zoomBy(1.25)} aria-label="放大">＋</button>
          <button className="tool-button" onClick={fit}>适应</button>
          {fullscreen && (
            <button className="tool-button viewer-close" onClick={onCloseFullscreen}>
              关闭
            </button>
          )}
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
          event.currentTarget.setPointerCapture(event.pointerId);
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointersRef.current.size === 1) {
            panRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              startPanX: view.panX,
              startPanY: view.panY,
              moved: false
            };
            gestureRef.current = null;
          } else if (pointersRef.current.size === 2) {
            const measured = pointerDistance();
            gestureRef.current = measured
              ? {
                  startDist: measured.distance,
                  startZoom: zoom,
                  startPanX: view.panX,
                  startPanY: view.panY,
                  moved: false
                }
              : null;
            if (panRef.current?.moved) {
              gestureRef.current = null;
            }
          }
        }}
        onPointerMove={(event) => {
          const stored = pointersRef.current.get(event.pointerId);
          if (!stored) return;
          stored.x = event.clientX;
          stored.y = event.clientY;
          if (pointersRef.current.size >= 2) {
            updatePinch(event);
            if (panRef.current) panRef.current.moved = true;
            return;
          }
          const pan = panRef.current;
          if (!pan) return;
          const dx = event.clientX - pan.startX;
          const dy = event.clientY - pan.startY;
          if (Math.hypot(dx, dy) > 4) {
            pan.moved = true;
            onHover(null);
          }
          onView({ panX: pan.startPanX + dx, panY: pan.startPanY + dy });
        }}
        onPointerUp={(event) => {
          const wasTouch = event.pointerType === 'touch';
          pointersRef.current.delete(event.pointerId);
          const noDrag = !panRef.current?.moved && !gestureRef.current?.moved;
          if (pointersRef.current.size === 0) {
            if (noDrag && wasTouch) handleTap(event.clientX, event.clientY);
            panRef.current = null;
            gestureRef.current = null;
          }
        }}
        onPointerCancel={(event) => {
          pointersRef.current.delete(event.pointerId);
          if (pointersRef.current.size === 0) {
            panRef.current = null;
            gestureRef.current = null;
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') onHover(null);
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          toggleDoubleZoom(event.clientX, event.clientY);
        }}
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
      <div className="preview-mobile-controls">
        <button className="tool-button" onClick={() => zoomBy(0.8)} aria-label="缩小">−</button>
        <button className="tool-button" onClick={() => zoomBy(1.25)} aria-label="放大">＋</button>
        <button className="tool-button" onClick={fit}>适应</button>
        <button className="tool-button" onClick={() => onFullscreen?.()}>全屏</button>
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
        {fullscreen && (
          <button className="tool-button" onClick={onCloseFullscreen}>关闭全屏</button>
        )}
      </div>
      {!fullscreen && (
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
      )}
    </section>
  );
}
