import type { Pattern } from '../../types';

/** 把内容图居中放进方形底板，外围 cells = -1（留空）。 */
export function placeContain(
  content: Pattern,
  boardWidth: number,
  boardHeight: number
): Pattern {
  const cells = new Int16Array(boardWidth * boardHeight).fill(-1);
  const ox = Math.max(0, Math.floor((boardWidth - content.width) / 2));
  const oy = Math.max(0, Math.floor((boardHeight - content.height) / 2));
  for (let y = 0; y < content.height; y += 1) {
    if (oy + y >= boardHeight) break;
    const sourceRow = y * content.width;
    const targetRow = (oy + y) * boardWidth + ox;
    for (let x = 0; x < content.width; x += 1) {
      if (ox + x >= boardWidth) break;
      cells[targetRow + x] = content.cells[sourceRow + x];
    }
  }
  return {
    ...content,
    width: boardWidth,
    height: boardHeight,
    cells,
    options: {
      ...content.options,
      width: boardWidth,
      height: boardHeight,
      contain: {
        contentWidth: content.width,
        contentHeight: content.height
      }
    }
  };
}
