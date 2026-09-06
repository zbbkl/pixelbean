import type { Pattern } from '../types';
import { drawGrid } from '../core/render/drawGrid';
import type { LoadedPalette } from '../core/palette/types';

const PAGE_COLS = 24;
const PAGE_ROWS = 17;
const CELL_PX = 26;

function pageCount(width: number, height: number): { pagesX: number; pagesY: number } {
  return {
    pagesX: Math.ceil(width / PAGE_COLS),
    pagesY: Math.ceil(height / PAGE_ROWS)
  };
}

function subPattern(source: Pattern, x: number, y: number, cols: number, rows: number): Pattern {
  const cells = new Int16Array(cols * rows);
  for (let py = 0; py < rows; py += 1) {
    const sy = y + py;
    if (sy >= source.height) {
      cells.fill(-1, py * cols, (py + 1) * cols);
      continue;
    }
    for (let px = 0; px < cols; px += 1) {
      const sx = x + px;
      cells[py * cols + px] = sx < source.width ? source.cells[sy * source.width + sx] : -1;
    }
  }
  return {
    ...source,
    width: cols,
    height: rows,
    cells
  };
}

function renderPage(source: Pattern, palette: LoadedPalette, px: number, py: number, pageNumber: number) {
  const cols = Math.min(PAGE_COLS, source.width - px);
  const rows = Math.min(PAGE_ROWS, source.height - py);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL_PX;
  canvas.height = rows * CELL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, subPattern(source, px, py, cols, rows), palette, {
    cellPx: CELL_PX,
    offsetX: 0,
    offsetY: 0,
    showCodes: true,
    showGridLines: true
  });

  const page = document.createElement('article');
  page.className = 'print-page';
  const header = document.createElement('div');
  header.className = 'print-page-label';
  header.textContent = `PixelBean · ${source.paletteId} · 第 ${pageNumber} 页`;
  const cell = document.createElement('canvas');
  cell.width = canvas.width;
  cell.height = canvas.height;
  cell.getContext('2d')?.drawImage(canvas, 0, 0);
  page.append(header, cell);
  document.querySelector('#print-root')?.append(page);
}

/** 生成分页打印视图并直接触发浏览器打印对话框。 */
export function printSheet(pattern: Pattern, palette: LoadedPalette): void {
  const root = document.querySelector('#print-root');
  if (!root) return;
  root.innerHTML = '';
  const { pagesX, pagesY } = pageCount(pattern.width, pattern.height);
  let pageNumber = 1;
  for (let py = 0; py < pagesY; py += 1) {
    for (let px = 0; px < pagesX; px += 1) {
      renderPage(pattern, palette, px * PAGE_COLS, py * PAGE_ROWS, pageNumber);
      pageNumber += 1;
    }
  }
  window.print();
}
