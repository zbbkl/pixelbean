import { clampPan, PADDING } from './gesture';

/** CSS px/格；zoom<1 允许整张大图在窄视口内完整显示（docs/18 §3.1 I5）。 */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 96;
export const FIT_PAD = 16;

/**
 * 适应缩放：宽/高两方向容纳比例取小，保证整图可见。
 * raw>=1 时向下取整（避免 1px 溢出）；raw<1 时保留原值以支持 zoom<1。
 */
export function fitZoom(
  viewW: number,
  viewH: number,
  gridW: number,
  gridH: number
): number {
  const sx = (viewW - 2 * FIT_PAD) / Math.max(1, gridW);
  const sy = (viewH - 2 * FIT_PAD) / Math.max(1, gridH);
  const raw = Math.min(sx, sy);
  const zoom = raw >= 1 ? Math.floor(raw) : raw;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/** 网格中心对准查看区中心的 pan（未 clamp；调用方在拿到网格尺寸后统一收口）。 */
export function centerPan(
  viewW: number,
  viewH: number,
  zoom: number,
  gridW: number,
  gridH: number
): { panX: number; panY: number } {
  return {
    panX: (viewW - gridW * zoom) / 2 - PADDING,
    panY: (viewH - gridH * zoom) / 2 - PADDING
  };
}

/**
 * 锚点缩放：缩放前后，查看区局部点 (localX, localY) 下的网格坐标保持不变。
 * pan 是否落入合法边界由调用方用 clampPan 收口（函数签名保留注入位）。
 */
export function zoomAround(
  view: { zoom: number; panX: number; panY: number },
  localX: number,
  localY: number,
  factor: number
): { zoom: number; panX: number; panY: number } {
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
  const wx = (localX - PADDING - view.panX) / Math.max(1e-6, view.zoom);
  const wy = (localY - PADDING - view.panY) / Math.max(1e-6, view.zoom);
  return {
    zoom: next,
    panX: localX - PADDING - wx * next,
    panY: localY - PADDING - wy * next
  };
}

/** 无锚点事件（+/− 按钮）：保持查看区中心下的网格点不动。 */
export function zoomCentered(
  view: { zoom: number; panX: number; panY: number },
  viewW: number,
  viewH: number,
  factor: number
): { zoom: number; panX: number; panY: number } {
  return zoomAround(view, viewW / 2, viewH / 2, factor);
}

/** 可见格子区间（col1/row1 为开区间）；画布外全不可见时返回 null。 */
export function visibleCellRange(
  gridW: number,
  gridH: number,
  offsetX: number,
  offsetY: number,
  cellPx: number,
  canvasW: number,
  canvasH: number
): { col0: number; row0: number; col1: number; row1: number } | null {
  if (canvasW <= 0 || canvasH <= 0 || cellPx <= 0) return null;
  const col0 = Math.max(0, Math.floor(-offsetX / cellPx));
  const col1 = Math.min(gridW, Math.ceil((canvasW - offsetX) / cellPx));
  const row0 = Math.max(0, Math.floor(-offsetY / cellPx));
  const row1 = Math.min(gridH, Math.ceil((canvasH - offsetY) / cellPx));
  if (col0 >= col1 || row0 >= row1) return null;
  return { col0, row0, col1, row1 };
}

export type { PanClamp } from './gesture';
export { clampPan, PADDING };
