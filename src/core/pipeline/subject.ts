import type { CellImage } from '../../types';
import { ciede76 } from '../color/ciede2000';
import { srgbRgbToLab } from '../color/lab';

export interface SubjectOptions {
  /** 背景容差（Lab ΔE76）。 */
  tol?: number;
  /** 本地梯度上限；轮廓梯度高于此值时洪水停止。 */
  edge?: number;
  /** 主体小孤岛面积下限（像素）。 */
  minArea?: number;
  /** 主体内背景洞面积上限（像素），小于等于此值的闭合洞被回填。 */
  holeMax?: number;
  /** 有原始透明背景时，alpha 低于此值的边界视为透明背景。 */
  alphaThreshold?: number;
}

export interface SubjectResult {
  /** 主体保留原 RGBA；背景 alpha=0。 */
  cells: Uint8ClampedArray;
  /** 1=主体，0=背景（已抠出）。 */
  mask: Uint8Array;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const SUBJECT_TOL = 13;
export const SUBJECT_EDGE = 18;
export const SUBJECT_MIN_AREA_RATIO = 0.0002;
export const SUBJECT_HOLE_MAX = 24;
export const SUBJECT_ALPHA_THRESHOLD = 32;

function rgbAt(data: Uint8ClampedArray, offset: number): [number, number, number] {
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function labAt(data: Uint8ClampedArray, offset: number): [number, number, number] {
  return srgbRgbToLab(rgbAt(data, offset));
}

function measureComponent(
  mask: Uint8Array,
  width: number,
  height: number,
  start: number,
  target: number,
  visited: Uint8Array
): { count: number; touchesBorder: boolean } {
  const stack: number[] = [];
  stack.push(start);
  visited[start] = 1;
  let count = 0;
  let touchesBorder = false;
  while (stack.length) {
    const at = stack.pop()!;
    count += 1;
    const x = at % width;
    const y = Math.floor(at / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
    if (x > 0) {
      const n = at - 1;
      if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); }
    }
    if (x < width - 1) {
      const n = at + 1;
      if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); }
    }
    if (y > 0) {
      const n = at - width;
      if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); }
    }
    if (y < height - 1) {
      const n = at + width;
      if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); }
    }
  }
  return { count, touchesBorder };
}

function clearComponent(mask: Uint8Array, width: number, height: number, start: number, value: number): void {
  const stack: number[] = [start];
  const old = mask[start];
  mask[start] = value;
  while (stack.length) {
    const at = stack.pop()!;
    const x = at % width;
    const y = Math.floor(at / width);
    const candidates = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1
    ];
    for (const next of candidates) {
      if (next >= 0 && mask[next] === old) {
        mask[next] = value;
        stack.push(next);
      }
    }
  }
}

function borderIndices(width: number, height: number): number[] {
  const indices: number[] = [];
  for (let x = 0; x < width; x += 1) {
    indices.push(x);
    if (height > 1) indices.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    indices.push(y * width);
    if (width > 1) indices.push(y * width + width - 1);
  }
  return indices;
}

function hasTransparentBorder(data: Uint8ClampedArray, width: number, height: number, alphaThreshold: number): boolean {
  const border = borderIndices(width, height);
  let count = 0;
  for (const index of border) if (data[index * 4 + 3] <= alphaThreshold) count += 1;
  return count >= Math.max(2, Math.floor(border.length * 0.02));
}

function floodTransparentBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): Uint8Array {
  const length = width * height;
  const bg = new Uint8Array(length);
  const stack = new Int32Array(length);
  let head = 0;
  let tail = 0;
  const border = borderIndices(width, height);
  for (const index of border) {
    if (data[index * 4 + 3] <= alphaThreshold) {
      bg[index] = 1;
      stack[tail] = index;
      tail += 1;
    }
  }
  while (head < tail) {
    const at = stack[head];
    head += 1;
    const x = at % width;
    const y = Math.floor(at / width);
    const candidates = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1
    ];
    for (const next of candidates) {
      if (next < 0 || bg[next]) continue;
      if (data[next * 4 + 3] <= alphaThreshold) {
        bg[next] = 1;
        stack[tail] = next;
        tail += 1;
      }
    }
  }
  return bg;
}

function borderMedianLab(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const entries: { lab: [number, number, number]; index: number }[] = [];
  for (const index of borderIndices(width, height)) {
    entries.push({ lab: labAt(data, index * 4), index });
  }
  entries.sort((a, b) => a.lab[0] - b.lab[0] || a.lab[1] - b.lab[1] || a.lab[2] - b.lab[2]);
  return entries[Math.floor(entries.length / 2)].lab;
}

function maxNeighborDelta(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  at: number,
  lab: readonly [number, number, number]
): number {
  const x = at % width;
  const y = Math.floor(at / width);
  let max = 0;
  if (x > 0) max = Math.max(max, ciede76(lab, labAt(data, (at - 1) * 4)));
  if (x < width - 1) max = Math.max(max, ciede76(lab, labAt(data, (at + 1) * 4)));
  if (y > 0) max = Math.max(max, ciede76(lab, labAt(data, (at - width) * 4)));
  if (y < height - 1) max = Math.max(max, ciede76(lab, labAt(data, (at + width) * 4)));
  return max;
}

function floodColorBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tol: number,
  edge: number
): { bg: Uint8Array; reliable: boolean } {
  const length = width * height;
  const bg = new Uint8Array(length);
  const bgLab = borderMedianLab(data, width, height);
  const border = borderIndices(width, height);
  let seedCount = 0;
  for (const index of border) {
    if (ciede76(bgLab, labAt(data, index * 4)) <= tol) {
      bg[index] = 1;
      seedCount += 1;
    }
  }
  const minSeeds = Math.max(4, Math.floor(border.length * 0.12));
  if (seedCount < minSeeds) return { bg: new Uint8Array(length), reliable: false };

  const stack = new Int32Array(length);
  let head = 0;
  let tail = 0;
  for (const index of border) if (bg[index]) { stack[tail] = index; tail += 1; }

  while (head < tail) {
    const at = stack[head];
    head += 1;
    const x = at % width;
    const y = Math.floor(at / width);
    const candidates = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1
    ];
    for (const next of candidates) {
      if (next < 0 || bg[next]) continue;
      const offset = next * 4;
      if (data[offset + 3] < 128) continue;
      const lab = labAt(data, offset);
      if (ciede76(bgLab, lab) > tol) continue;
      if (maxNeighborDelta(data, width, height, next, lab) > edge) continue;
      bg[next] = 1;
      stack[tail] = next;
      tail += 1;
    }
  }
  const dilated = bg.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (bg[index] || data[index * 4 + 3] < 128) continue;
      const lab = labAt(data, index * 4);
      if (ciede76(bgLab, lab) > tol) continue;
      const bgNeighbor =
        (x > 0 && bg[index - 1]) ||
        (x < width - 1 && bg[index + 1]) ||
        (y > 0 && bg[index - width]) ||
        (y < height - 1 && bg[index + width]);
      if (bgNeighbor) dilated[index] = 1;
    }
  }
  return { bg: dilated, reliable: true };
}

function fillSmallHoles(mask: Uint8Array, width: number, height: number, holeMax: number): Uint8Array {
  const output = mask.slice();
  const visited = new Uint8Array(output.length);
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== 0 || visited[start]) continue;
    const { count, touchesBorder } = measureComponent(output, width, height, start, 0, visited);
    if (!touchesBorder && count <= holeMax) {
      clearComponent(output, width, height, start, 1);
    }
  }
  return output;
}

function dropTinyIslands(mask: Uint8Array, width: number, height: number, minArea: number): Uint8Array {
  if (minArea <= 1) return mask;
  const output = mask.slice();
  const visited = new Uint8Array(output.length);
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== 1 || visited[start]) continue;
    const { count } = measureComponent(output, width, height, start, 1, visited);
    if (count < minArea) clearComponent(output, width, height, start, 0);
  }
  return output;
}

/**
 * 像素化前的一键去背景：白底/纯色底照片用「边界背景色 + 梯度停止洪水」
 * 抠主体；已带透明背景的 PNG 沿 alpha 扩展背景。输出确定性纯函数。
 */
export function extractSubject(
  source: CellImage,
  opts: SubjectOptions = {}
): SubjectResult {
  const width = source.width;
  const height = source.height;
  const data = source.data;
  const length = width * height;
  const tol = opts.tol ?? SUBJECT_TOL;
  const edge = opts.edge ?? SUBJECT_EDGE;
  const minArea = opts.minArea ?? Math.max(8, Math.floor(length * SUBJECT_MIN_AREA_RATIO));
  const holeMax = opts.holeMax ?? SUBJECT_HOLE_MAX;
  const alphaThreshold = opts.alphaThreshold ?? SUBJECT_ALPHA_THRESHOLD;

  let background: Uint8Array;
  if (hasTransparentBorder(data, width, height, alphaThreshold)) {
    background = floodTransparentBackground(data, width, height, alphaThreshold);
  } else {
    const result = floodColorBackground(data, width, height, tol, edge);
    if (!result.reliable) {
      // 边界没有可辨识的连续背景：视作主体已经占满画布，不做误抠。
      const all = new Uint8Array(length).fill(1);
      const outAll = new Uint8ClampedArray(data);
      return {
        cells: outAll,
        mask: all,
        bbox: { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }
      };
    }
    background = result.bg;
  }

  const mask = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    if (!background[i] && data[i * 4 + 3] > 0) mask[i] = 1;
  }

  const cleanedMask = dropTinyIslands(fillSmallHoles(mask, width, height, holeMax), width, height, minArea);
  const cells = new Uint8ClampedArray(data);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!cleanedMask[index]) {
        cells[index * 4 + 3] = 0;
      } else {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  const bbox = Number.isFinite(x0)
    ? { x0, y0, x1, y1 }
    : null;
  return { cells, mask: cleanedMask, bbox };
}

export function downsampleMask(
  mask: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number
): Uint8Array {
  const out = new Uint8Array(outWidth * outHeight);
  for (let gy = 0; gy < outHeight; gy += 1) {
    const y0 = Math.floor((gy * srcHeight) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * srcHeight) / outHeight));
    for (let gx = 0; gx < outWidth; gx += 1) {
      const x0 = Math.floor((gx * srcWidth) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * srcWidth) / outWidth));
      let occupied = false;
      for (let y = y0; y < y1 && !occupied; y += 1) {
        const row = y * srcWidth;
        for (let x = x0; x < x1; x += 1) {
          if (mask[row + x]) {
            occupied = true;
            break;
          }
        }
      }
      out[gy * outWidth + gx] = occupied ? 1 : 0;
    }
  }
  return out;
}
