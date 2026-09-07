import type { Pattern } from '../../types';
import { displayCode, hexOf } from '../palette/codeStyle';
import type { LoadedPalette } from '../palette/types';
import { relativeLuminance } from '../color/srgb';

export interface GridHover {
  x: number;
  y: number;
}

export interface DrawGridView {
  /** 每个格子的物理画布像素。 */
  cellPx: number;
  offsetX: number;
  offsetY: number;
  showCodes: boolean;
  showGridLines: boolean;
  hover?: GridHover | null;
}

/** 可见格子区间，col1/row1 为开区间；缺省时绘制全图。 */
export interface CellRange {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

function textColorFor(color: { hex: string | null; rgb?: [number, number, number] }): string {
  const rgb: [number, number, number] = color.rgb ?? [255, 255, 255];
  return relativeLuminance(rgb) < 0.45 ? '#ffffff' : '#111111';
}

/** 整图绘制；坐标使用物理像素，缩放由调用方折算进 cellPx/offset。 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  palette: LoadedPalette,
  view: DrawGridView,
  range?: CellRange | null
): void {
  const { width, height, cells } = pattern;
  const { cellPx, offsetX, offsetY, showCodes, showGridLines, hover } = view;
  const y0 = range ? Math.max(0, Math.min(height, range.row0)) : 0;
  const y1 = range ? Math.max(y0, Math.min(height, range.row1)) : height;
  const x0 = range ? Math.max(0, Math.min(width, range.col0)) : 0;
  const x1 = range ? Math.max(x0, Math.min(width, range.col1)) : width;
  const codeStyle = palette.set.codeStyle;
  const showText = showCodes && cellPx >= 14;
  const showBorders = showGridLines && cellPx >= 14;
  const inset = showBorders ? Math.min(0.75, cellPx * 0.04) : 0;
  const fontSize = Math.max(7, Math.floor(cellPx * 0.42));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = cells[y * width + x];
      if (index < 0) continue;
      const color = palette.solids[index];
      const px = offsetX + x * cellPx;
      const py = offsetY + y * cellPx;
      ctx.fillStyle = hexOf(color) ?? '#ffffff';
      ctx.fillRect(px + inset, py + inset, cellPx - inset * 2, cellPx - inset * 2);

      if (showText) {
        ctx.fillStyle = textColorFor(color);
        ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        ctx.fillText(displayCode(color.code, codeStyle), px + cellPx / 2, py + cellPx / 2 + 0.5, cellPx - 1);
      }
    }
  }

  if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < width && hover.y < height) {
    const px = offsetX + hover.x * cellPx;
    const py = offsetY + hover.y * cellPx;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, cellPx * 0.12);
    ctx.strokeRect(px, py, cellPx, cellPx);
    ctx.strokeStyle = '#d33a2f';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
  }
  ctx.restore();
}
