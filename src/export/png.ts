import type { Pattern } from '../types';
import { drawGrid } from '../core/render/drawGrid';
import type { LoadedPalette } from '../core/palette/types';

export type PngMode = 'codes' | 'colors' | 'coordinates';

function chooseCellPx(pattern: Pattern): number {
  const longest = Math.max(pattern.width, pattern.height);
  const byMax = Math.floor(2800 / Math.max(1, longest));
  return Math.max(14, Math.min(44, byMax));
}

function drawCoordinateLabels(ctx: CanvasRenderingContext2D, pattern: Pattern, cellPx: number, margin: number) {
  ctx.save();
  ctx.font = `600 ${Math.max(9, Math.floor(cellPx * 0.28))}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a6572';
  for (let x = 0; x < pattern.width; x += 1) {
    const show = x === 0 || x === pattern.width - 1 || x % 10 === 0;
    if (show) ctx.fillText(String(x + 1), margin + (x + 0.5) * cellPx, margin / 2);
  }
  ctx.textAlign = 'right';
  for (let y = 0; y < pattern.height; y += 1) {
    const show = y === 0 || y === pattern.height - 1 || y % 10 === 0;
    if (show) ctx.fillText(String(y + 1), margin - 5, margin + (y + 0.5) * cellPx);
  }
  ctx.restore();
}

export function exportPng(pattern: Pattern, palette: LoadedPalette, mode: PngMode, cellPx = 0): Promise<Blob> {
  const size = cellPx > 0 ? cellPx : chooseCellPx(pattern);
  const margin = mode === 'coordinates' ? Math.max(34, Math.round(size * 1.1)) : 0;
  const width = pattern.width * size + margin * 2;
  const height = pattern.height * size + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D 不可用'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid(ctx, pattern, palette, {
    cellPx: size,
    offsetX: margin,
    offsetY: margin,
    showCodes: mode !== 'colors',
    showGridLines: mode !== 'colors'
  });
  if (mode === 'coordinates') drawCoordinateLabels(ctx, pattern, size, margin);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 导出失败'));
    }, 'image/png');
  });
}
