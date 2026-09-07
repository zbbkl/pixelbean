import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Pattern } from '../../types';
import { drawGrid } from '../../core/render/drawGrid';
import type { LoadedPalette } from '../../core/palette/types';
import { clampPan, PADDING } from '../gesture';
import {
  centerPan,
  fitZoom,
  visibleCellRange,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAround,
  zoomCentered
} from '../viewport';
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

interface PointerPos {
  x: number;
  y: number;
}

/* 主预览与全屏查看器共享 ViewState；fit 会话也共享，避免兄弟实例相互复位。 */
const viewSession = { userZoomed: false, fittedZoom: 0 };

export function PreviewCanvas({
  pattern, palette, source, loading, fullscreen = false,
  showCodes, showGridLines, onToggleCodes, onToggleGrid,
  onFullscreen, onCloseFullscreen, hover, view, onHover, onView
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState({ width: 600, height: 420 });
  const contentSizeRef = useRef(contentSize);
  contentSizeRef.current = contentSize;
  const pointersRef = useRef<Map<number, PointerPos>>(new Map());
  const panRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean } | null>(null);
  const gestureRef = useRef<{ startDist: number; startZoom: number; startPanX: number; startPanY: number; moved: boolean } | null>(null);
  const spaceHeldRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const suppressDblClickRef = useRef(0);
  const lastPatternRef = useRef<Pattern | null>(pattern);
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom));
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setContentSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = () => {
    if (!pattern) return;
    const viewW = Math.max(1, contentSizeRef.current.width);
    const viewH = Math.max(1, contentSizeRef.current.height);
    const nextZoom = fitZoom(viewW, viewH, pattern.width, pattern.height);
    const pan = centerPan(viewW, viewH, nextZoom, pattern.width, pattern.height);
    const clamped = clampPan(pattern.width * nextZoom, pattern.height * nextZoom, viewW, viewH, pan.panX, pan.panY);
    viewSession.fittedZoom = nextZoom;
    viewSession.userZoomed = false;
    onView({ zoom: nextZoom, panX: clamped.panX, panY: clamped.panY });
  };
  const clampView = (next: { zoom: number; panX: number; panY: number }) => {
    if (!pattern) return next;
    const viewW = Math.max(1, contentSizeRef.current.width);
    const viewH = Math.max(1, contentSizeRef.current.height);
    const clamped = clampPan(pattern.width * next.zoom, pattern.height * next.zoom, viewW, viewH, next.panX, next.panY);
    return { zoom: next.zoom, panX: clamped.panX, panY: clamped.panY };
  };

  useEffect(() => {
    const changed = lastPatternRef.current !== pattern;
    lastPatternRef.current = pattern;
    if (!pattern || !changed) return;
    const timer = window.setTimeout(fit, 40);
    return () => window.clearTimeout(timer);
  }, [pattern]);
  useEffect(() => {
    if (!pattern || contentSize.width < 1 || contentSize.height < 1) return;
    if (viewSession.userZoomed) {
      const next = clampView({ zoom, panX: view.panX, panY: view.panY });
      if (next.panX !== view.panX || next.panY !== view.panY) onView({ panX: next.panX, panY: next.panY });
      return;
    }
    const timer = window.setTimeout(fit, 40);
    return () => window.clearTimeout(timer);
  }, [contentSize.width, contentSize.height]);
  useEffect(() => {
    const releaseSpace = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      document.body.classList.remove('pan-space');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = event.target instanceof HTMLElement ? event.target.tagName : '';
      if (event.code === 'Space' && !spaceHeldRef.current && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        event.preventDefault();
        spaceHeldRef.current = true;
        document.body.classList.add('pan-space');
      } else if (event.code === 'Escape') releaseSpace();
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') releaseSpace(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseSpace);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSpace);
      releaseSpace();
    };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const physicalW = Math.max(1, Math.ceil(contentSize.width * dpr));
    const physicalH = Math.max(1, Math.ceil(contentSize.height * dpr));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (canvas.width !== physicalW || canvas.height !== physicalH) {
      canvas.width = physicalW;
      canvas.height = physicalH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pattern || !palette) return;
    // I1：位图恒定 = 查看区×dpr；缩放/平移只改变绘制变换并裁剪可见格。
    const cellPx = zoom * dpr;
    const offsetX = (PADDING + view.panX) * dpr;
    const offsetY = (PADDING + view.panY) * dpr;
    const range = visibleCellRange(pattern.width, pattern.height, offsetX, offsetY, cellPx, canvas.width, canvas.height);
    if (range) {
      drawGrid(ctx, pattern, palette, {
        cellPx, offsetX, offsetY, showCodes, showGridLines, hover
      }, range);
    }
  }, [
    pattern, palette, zoom, view.panX, view.panY,
    showCodes, showGridLines, hover, contentSize.width, contentSize.height
  ]);
  const hitCellAtClient = (clientX: number, clientY: number): HoverCell | null => {
    if (!pattern) return null;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const gx = Math.floor((clientX - rect.left - PADDING - view.panX) / zoom);
    const gy = Math.floor((clientY - rect.top - PADDING - view.panY) / zoom);
    if (gx < 0 || gy < 0 || gx >= pattern.width || gy >= pattern.height) return null;
    return { x: gx, y: gy };
  };

  const markUserZoom = () => { viewSession.userZoomed = true; };

  const toggleDoubleZoom = (clientX: number, clientY: number) => {
    if (!pattern) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nearFit = viewSession.fittedZoom > 0 && zoom <= viewSession.fittedZoom * 1.05;
    if (!nearFit) { fit(); return; }
    const next = zoomAround(
      { zoom, panX: view.panX, panY: view.panY },
      clientX - rect.left,
      clientY - rect.top,
      2
    );
    const clamped = clampView(next);
    markUserZoom();
    onView({ zoom: clamped.zoom, panX: clamped.panX, panY: clamped.panY });
  };

  const handleTap = (clientX: number, clientY: number) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.time < 350 && Math.hypot(clientX - last.x, clientY - last.y) < 32) {
      lastTapRef.current = null;
      suppressDblClickRef.current = now;
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

  const updatePinch = () => {
    const gesture = gestureRef.current;
    const measured = pointerDistance();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!gesture || !measured || !rect) return;
    if (Math.abs(measured.distance - gesture.startDist) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    const ratio = measured.distance / Math.max(1, gesture.startDist);
    const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gesture.startZoom * ratio));
    const localCenterX = measured.centerX - rect.left;
    const localCenterY = measured.centerY - rect.top;
    const gx = (localCenterX - PADDING - gesture.startPanX) / Math.max(1e-6, gesture.startZoom);
    const gy = (localCenterY - PADDING - gesture.startPanY) / Math.max(1e-6, gesture.startZoom);
    const clamped = clampView({
      zoom: nextZoom,
      panX: localCenterX - PADDING - gx * nextZoom,
      panY: localCenterY - PADDING - gy * nextZoom
    });
    markUserZoom();
    onView({ zoom: clamped.zoom, panX: clamped.panX, panY: clamped.panY });
  };

  const zoomBy = (factor: number) => {
    if (!pattern) return;
    const next = zoomCentered(
      { zoom, panX: view.panX, panY: view.panY },
      Math.max(1, contentSizeRef.current.width),
      Math.max(1, contentSizeRef.current.height),
      factor
    );
    const clamped = clampView(next);
    markUserZoom();
    onView({ zoom: clamped.zoom, panX: clamped.panX, panY: clamped.panY });
  };

  const zoomByWheel = (clientX: number, clientY: number, factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = zoomAround(
      { zoom, panX: view.panX, panY: view.panY },
      clientX - rect.left,
      clientY - rect.top,
      factor
    );
    const clamped = clampView(next);
    markUserZoom();
    onView({ zoom: clamped.zoom, panX: clamped.panX, panY: clamped.panY });
  };

  const hoverIndex = hover && pattern ? pattern.cells[hover.y * pattern.width + hover.x] : -1;
  const hoverColor = hoverIndex >= 0 && palette ? palette.solids[hoverIndex] : null;
  const removePanCursor = (element: HTMLDivElement) => {
    if (pointersRef.current.size === 0) element.classList.remove('is-panning');
  };

  return (
    <section className={`preview-pane ${fullscreen ? 'fullscreen-preview' : ''}`}>
      <div className="pane-toolbar">
        <span className="pane-title">{fullscreen ? '全屏图纸' : '图纸'}</span>
        <div className="tool-group">
          <button className="tool-button" onClick={() => zoomBy(0.8)} aria-label="缩小">−</button>
          <span className="zoom-label">{Math.round(zoom)} px</span>
          <button className="tool-button" onClick={() => zoomBy(1.25)} aria-label="放大">＋</button>
          <button className="tool-button" onClick={fit}>适应</button>
          {fullscreen && <button className="tool-button viewer-close" onClick={onCloseFullscreen}>关闭</button>}
        </div>
        <div className="tool-group">
          <button className={`tool-toggle ${showCodes ? 'active' : ''}`} onClick={() => onToggleCodes(!showCodes)}>色号</button>
          <button className={`tool-toggle ${showGridLines ? 'active' : ''}`} onClick={() => onToggleGrid(!showGridLines)}>格线</button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="canvas-scroll"
        data-zoom={Math.round(zoom * 100)}
        data-pan-x={Math.round(view.panX)}
        data-pan-y={Math.round(view.panY)}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add('is-panning');
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointersRef.current.size === 1) {
            panRef.current = {
              startX: event.clientX, startY: event.clientY,
              startPanX: view.panX, startPanY: view.panY, moved: false
            };
            gestureRef.current = null;
          } else if (pointersRef.current.size === 2) {
            const measured = pointerDistance();
            gestureRef.current = measured
              ? {
                  startDist: measured.distance, startZoom: zoom,
                  startPanX: view.panX, startPanY: view.panY, moved: false
                }
              : null;
            if (panRef.current?.moved) gestureRef.current = null;
          }
        }}
        onPointerMove={(event) => {
          const stored = pointersRef.current.get(event.pointerId);
          if (!stored) {
            if (event.pointerType === 'mouse') onHover(hitCellAtClient(event.clientX, event.clientY));
            return;
          }
          stored.x = event.clientX;
          stored.y = event.clientY;
          if (pointersRef.current.size >= 2) {
            updatePinch();
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
          const clamped = clampView({ zoom, panX: pan.startPanX + dx, panY: pan.startPanY + dy });
          onView({ panX: clamped.panX, panY: clamped.panY });
        }}
        onPointerUp={(event) => {
          const wasTouch = event.pointerType === 'touch';
          const noDrag = !panRef.current?.moved && !gestureRef.current?.moved;
          pointersRef.current.delete(event.pointerId);
          if (pointersRef.current.size === 0) {
            removePanCursor(event.currentTarget);
            if (noDrag && wasTouch) handleTap(event.clientX, event.clientY);
            panRef.current = null;
            gestureRef.current = null;
          }
        }}
        onPointerCancel={(event) => {
          pointersRef.current.delete(event.pointerId);
          if (pointersRef.current.size === 0) {
            removePanCursor(event.currentTarget);
            panRef.current = null;
            gestureRef.current = null;
          }
        }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') onHover(null); }}
        onWheel={(event) => {
          zoomByWheel(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (Date.now() - suppressDblClickRef.current < 300) return;
          toggleDoubleZoom(event.clientX, event.clientY);
        }}
      >
        <canvas ref={canvasRef} className="preview-canvas" />
        {hoverColor && (
          <div className="hover-bar">
            <span className="swatch" style={{ background: hoverColor.hex ?? '#fff' }} />
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
        <button className={`tool-toggle ${showCodes ? 'active' : ''}`} onClick={() => onToggleCodes(!showCodes)}>色号</button>
        <button className={`tool-toggle ${showGridLines ? 'active' : ''}`} onClick={() => onToggleGrid(!showGridLines)}>格线</button>
        {fullscreen && <button className="tool-button" onClick={onCloseFullscreen}>关闭全屏</button>}
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
          <span className="desktop-pan-hint">拖拽/空格拖拽=平移 · 滚轮=缩放 · 双击=放大/适应</span>
        </div>
      )}
    </section>
  );
}
