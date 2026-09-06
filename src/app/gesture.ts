export const PADDING = 40;

export interface PanClamp {
  panX: number;
  panY: number;
}

/**
 * 把 pan 限制在"网格至少保留 margin 像素可见"的范围内，防止拖拽/捏合
 * 把图纸整体拖出画布（docs/14 §2 P0-5「边界拖不跑出画布」）。
 * gridW/gridH 已按当前 zoom 换算为屏幕像素；viewW/viewH 为查看区尺寸。
 */
export function clampPan(
  gridW: number,
  gridH: number,
  viewW: number,
  viewH: number,
  panX: number,
  panY: number,
  margin = 24
): PanClamp {
  const clampAxis = (pan: number, gridSize: number, viewSize: number): number => {
    const min = margin - PADDING - gridSize;
    const max = viewSize - margin - PADDING;
    if (max < min) return 0;
    return Math.max(min, Math.min(max, pan));
  };
  return {
    panX: clampAxis(panX, gridW, viewW),
    panY: clampAxis(panY, gridH, viewH)
  };
}
