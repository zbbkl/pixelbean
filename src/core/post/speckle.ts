import type { Pattern } from '../../types';
import { ciede2000 } from '../color/ciede2000';
import type { LoadedPalette } from '../palette/types';

interface Component {
  color: number;
  cells: number[];
  boundary: Map<number, number>;
}

function labelComponents(pattern: Pattern): Component[] {
  const { width, height, cells } = pattern;
  const seen = new Int8Array(cells.length);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < cells.length; start += 1) {
    if (cells[start] < 0 || seen[start]) continue;
    const color = cells[start];
    const component: Component = { color, cells: [], boundary: new Map() };
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
        if (next < 0) continue;
        const nextColor = cells[next];
        if (nextColor < 0 || nextColor === color) {
          if (nextColor === color && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        } else {
          component.boundary.set(nextColor, (component.boundary.get(nextColor) ?? 0) + 1);
        }
      }
    }
    components.push(component);
  }
  return components;
}

interface BoundaryMajority {
  color: number;
  count: number;
  total: number;
}

function mostFrequentBoundary(boundary: Map<number, number>): number | null {
  let best = -1;
  let bestCount = 0;
  for (const [index, count] of boundary) {
    if (count > bestCount || (count === bestCount && index < best)) {
      best = index;
      bestCount = count;
    }
  }
  return best >= 0 ? best : null;
}

function labOf(palette: LoadedPalette, index: number): [number, number, number] {
  return [palette.labs[index * 3], palette.labs[index * 3 + 1], palette.labs[index * 3 + 2]];
}

/** §9.1：清掉 ≤noiseMax 格的孤立小域；与邻居 ΔE 超阈值时保留。 */
export function speckleClean(
  pattern: Pattern,
  palette: LoadedPalette,
  noiseMax = 2,
  deltaEthr = 30
): Pattern {
  const components = labelComponents(pattern).sort(
    (a, b) => a.cells.length - b.cells.length || a.color - b.color
  );
  if (!components.length) return pattern;
  const cells = new Int16Array(pattern.cells);

  for (const component of components) {
    if (component.cells.length > noiseMax) continue;
    const target = mostFrequentBoundary(component.boundary);
    if (target === null || target === component.color) continue;
    const delta = ciede2000(labOf(palette, component.color), labOf(palette, target));
    if (delta > deltaEthr) continue;
    for (const cell of component.cells) cells[cell] = target;
  }

  return { ...pattern, cells };
}

/**
 * §v1.2 二阶孤立噪点清理：先做“单格 + 至少 2 边贴主色”的一阶删除，
 * 再对 2..N 格连通域执行贴附强度合并；含 protect 掩码的域整体跳过。
 */
export function speckleCleanV2(
  pattern: Pattern,
  palette: LoadedPalette,
  noiseMax = 2,
  deltaEthr = 30,
  protect: Uint8Array | null = null
): Pattern {
  const cells = new Int16Array(pattern.cells);

  const majorityOf = (component: Component): BoundaryMajority | null => {
    let best = -1;
    let bestCount = 0;
    let total = 0;
    for (const [index, count] of component.boundary) {
      total += count;
      if (count > bestCount || (count === bestCount && index < best)) {
        best = index;
        bestCount = count;
      }
    }
    return total > 0 ? { color: best, count: bestCount, total } : null;
  };

  const isProtected = (component: Component) =>
    protect !== null && component.cells.some((cell) => protect[cell] === 1);
  const merge = (component: Component, target: number) => {
    for (const cell of component.cells) cells[cell] = target;
  };
  const mergeable = (component: Component, majority: BoundaryMajority) => {
    if (majority.color === component.color) return false;
    const delta = ciede2000(labOf(palette, component.color), labOf(palette, majority.color));
    return delta <= deltaEthr;
  };

  // Phase 1：单格删除，需要 ≥2 条边贴同一主体且占比 ≥50%（docs/19 S1）。
  for (const component of labelComponents(pattern).sort(
    (a, b) => a.cells.length - b.cells.length || a.color - b.color
  )) {
    if (component.cells.length !== 1 || isProtected(component)) continue;
    const majority = majorityOf(component);
    if (majority && majority.count >= 2 && majority.count / majority.total >= 0.5 && mergeable(component, majority)) {
      merge(component, majority.color);
    }
  }

  // Phase 2：2..N 格同色连通域，贴附边数 ≥ 域格数才并入主色。
  for (const component of labelComponents({ ...pattern, cells }).sort(
    (a, b) => a.cells.length - b.cells.length || a.color - b.color
  )) {
    if (component.cells.length < 2 || component.cells.length > noiseMax || isProtected(component)) continue;
    const majority = majorityOf(component);
    if (
      majority &&
      majority.count >= component.cells.length &&
      majority.count / majority.total >= 0.5 &&
      mergeable(component, majority)
    ) {
      merge(component, majority.color);
    }
  }

  return { ...pattern, cells };
}
