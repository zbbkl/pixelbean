import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

export const MERGE_DE = 6;
export const MERGE_MIN_AREA = 3;
export const MERGE_MAX_AREA = 40;

interface Component {
  color: number;
  cells: number[];
}

function labelComponents(pattern: Pattern): Component[] {
  const { width, height, cells } = pattern;
  const seen = new Int8Array(cells.length);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (cells[start] < 0 || seen[start]) continue;
    const color = cells[start];
    const component: Component = { color, cells: [] };
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop()!;
      component.cells.push(at);
      const x = at % width;
      const y = Math.floor(at / width);
      const neighbors = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        y > 0 ? at - width : -1,
        y < height - 1 ? at + width : -1
      ];
      for (const next of neighbors) {
        if (next < 0 || seen[next]) continue;
        if (cells[next] === color) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * v1.2-final E3：连通域邻接合并。3..40 格的同色系小块若贴附
 * 邻接主块且 ΔE<=deThr，则整块并入；跳过 protect/空格，不新增色号。
 */
export function mergeAdjacent(
  pattern: Pattern,
  palette: LoadedPalette,
  protect: Uint8Array | null = null,
  deThr = MERGE_DE,
  minArea = MERGE_MIN_AREA,
  maxArea = MERGE_MAX_AREA
): Pattern {
  const { width, height, cells } = pattern;
  const output = new Int16Array(cells.length);
  output.set(cells);
  let changed = false;

  const components = labelComponents(pattern).sort(
    (a, b) => a.cells.length - b.cells.length || a.color - b.color
  );
  for (const component of components) {
    const size = component.cells.length;
    if (size < minArea || size > maxArea) continue;
    if (protect && component.cells.some((cell) => protect[cell] === 1)) continue;
    const first = component.cells[0];
    if (output[first] !== component.color) continue;

    const boundary = new Map<number, number>();
    for (const at of component.cells) {
      const x = at % width;
      const y = Math.floor(at / width);
      const neighbors = [
        x > 0 ? at - 1 : -1,
        x < width - 1 ? at + 1 : -1,
        y > 0 ? at - width : -1,
        y < height - 1 ? at + width : -1
      ];
      for (const next of neighbors) {
        if (next < 0) continue;
        const color = output[next];
        if (color >= 0 && color !== component.color) {
          boundary.set(color, (boundary.get(color) ?? 0) + 1);
        }
      }
    }
    let target = -1;
    let targetCount = 0;
    for (const [color, count] of boundary) {
      if (count > targetCount || (count === targetCount && color < target)) {
        target = color;
        targetCount = count;
      }
    }
    if (target < 0) continue;
    const labColor: [number, number, number] = [
      palette.labs[component.color * 3],
      palette.labs[component.color * 3 + 1],
      palette.labs[component.color * 3 + 2]
    ];
    const labTarget: [number, number, number] = [
      palette.labs[target * 3],
      palette.labs[target * 3 + 1],
      palette.labs[target * 3 + 2]
    ];
    if (ciede2000(labColor, labTarget) > deThr) continue;
    for (const cell of component.cells) output[cell] = target;
    changed = true;
  }
  return changed ? { ...pattern, cells: output } : pattern;
}
