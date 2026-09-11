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
  /** A.2：抠图是否可信；false 时调用方必须按「未去背景」处理。 */
  reliable: boolean;
  /** 主体像素 / 全图像素。 */
  subjectRatio: number;
  /** 最大主体连通域 / 主体像素（「主体被打碎」的判据）。 */
  largestComponentRatio: number;
}

/** B-0：颜色容差收紧（原 13 太松，纯颜色即可吞近白主体）。 */
export const SUBJECT_TOL = 6;
/** B-0：多尺度结构梯度脊阈值（原 18 配单像素梯度，软轮廓永不触发）。 */
export const SUBJECT_EDGE = 12;
/** B-0：脊的多尺度半窗半径。 */
export const RIDGE_SCALES = [2, 4, 8] as const;
/** B-0：引导滤波窗口半径。 */
export const GUIDED_RADIUS = 4;
/** B-0：引导滤波正则项（guide 归一化到 [0,1]）。 */
export const GUIDED_EPS = 1e-3;
export const SUBJECT_MIN_AREA_RATIO = 0.0002;
export const SUBJECT_HOLE_MAX = 24;
export const SUBJECT_ALPHA_THRESHOLD = 32;
/** A.2 可信度门：主体占比下限（仅拦退化/空图，不误伤大画布上的小主体）。 */
export const SUBJECT_RATIO_MIN = 0.02;
/** A.2 可信度门：最大主体连通域占主体比例下限（拦「主体被打碎」＝吞掉近白主体）。 */
export const SUBJECT_COMPONENT_MIN = 0.9;
/** A.2 可信度门：主体包围盒占全幅上限（拦「几乎无背景可去」）。 */
export const SUBJECT_BBOX_MAX = 0.98;

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

/** B-1：（width+1）×（height+1）前缀和。 */
function integralOf(values: Float64Array, width: number, height: number): Float64Array {
  const W = width + 1;
  const out = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      out[(y + 1) * W + (x + 1)] = out[y * W + (x + 1)] + rowSum;
    }
  }
  return out;
}

/** 前缀和矩形求和；(x1,y1) 为开区间上界。 */
function rectSum(
  integral: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const W = width + 1;
  return integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
}

/**
 * B-1 多尺度结构梯度脊：ridge(p) = max_s ΔE76( innerMean_s(p), ringMean_s(p) )。
 * 软轮廓在粗尺度（s=4/8）仍成脊，补单像素梯度失效（docs/39 §4.3）。
 * 用三通道前缀和在 O(w·h·|scales|) 内完成，确定性、无依赖。
 */
export function buildRidge(data: Uint8ClampedArray, width: number, height: number): Float64Array {
  const length = width * height;
  const L = new Float64Array(length);
  const A = new Float64Array(length);
  const B = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const lab = labAt(data, i * 4);
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }
  const iL = integralOf(L, width, height);
  const iA = integralOf(A, width, height);
  const iB = integralOf(B, width, height);
  const ridge = new Float64Array(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = 0;
      for (const s of RIDGE_SCALES) {
        const inX0 = Math.max(0, x - s);
        const inX1 = Math.min(width, x + s + 1);
        const inY0 = Math.max(0, y - s);
        const inY1 = Math.min(height, y + s + 1);
        const outX0 = Math.max(0, x - 2 * s);
        const outX1 = Math.min(width, x + 2 * s + 1);
        const outY0 = Math.max(0, y - 2 * s);
        const outY1 = Math.min(height, y + 2 * s + 1);
        const nIn = (inX1 - inX0) * (inY1 - inY0);
        const nOut = (outX1 - outX0) * (outY1 - outY0);
        const nRing = nOut - nIn;
        if (nIn <= 0 || nRing <= 0) continue;
        const inL = rectSum(iL, width, inX0, inY0, inX1, inY1) / nIn;
        const inA = rectSum(iA, width, inX0, inY0, inX1, inY1) / nIn;
        const inB = rectSum(iB, width, inX0, inY0, inX1, inY1) / nIn;
        // ring = 外窗 − 内窗；`inL * nIn` 即内窗 Lab 和。
        const ringL = (rectSum(iL, width, outX0, outY0, outX1, outY1) - inL * nIn) / nRing;
        const ringA = (rectSum(iA, width, outX0, outY0, outX1, outY1) - inA * nIn) / nRing;
        const ringB = (rectSum(iB, width, outX0, outY0, outX1, outY1) - inB * nIn) / nRing;
        const d = ciede76([inL, inA, inB], [ringL, ringA, ringB]);
        if (d > best) best = d;
      }
      ridge[y * width + x] = best;
    }
  }
  return ridge;
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
  // B-1：在软轮廓处形成多尺度结构梯度屏障（替换原单像素 maxNeighborDelta 判据）。
  const ridge = buildRidge(data, width, height);
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
      if (ridge[next] > edge) continue;
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

/** B-2 盒均值（前缀和，O(w·h)）。 */
function boxMean(values: Float64Array, width: number, height: number, radius: number): Float64Array {
  const integral = integralOf(values, width, height);
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height, y + radius + 1);
      out[y * width + x] = rectSum(integral, width, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * B-2 引导滤波掩码精修（He et al. 2010，O(N) 确定性，零依赖）。
 * guide = 原图亮度；p = 二值掩码；输出 q >= 0.5 为掩码。
 *
 * 注意（实测，勿直接当最终掩码用）：q 是软 alpha，对**二值**掩码直接做 `q >= 0.5`
 * 阈值化，在引导平坦处会退化为「掩码的盒均值 > 0.5」，即 radius 尺度的凸角/细结构侵蚀
 * （实测 18×18 方块被啃掉 20 px）。本项目红线是绝不吞主体，因此 `extractSubject`
 * 只取本函数的**主体侧恢复**（与原掩码取并集），收缩交给 B-1 的脊屏障。
 */
export function refineMaskGuided(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  radius = GUIDED_RADIUS,
  eps = GUIDED_EPS
): Uint8Array {
  const length = width * height;
  const guide = new Float64Array(length);
  const p = new Float64Array(length);
  const gg = new Float64Array(length);
  const gp = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const offset = i * 4;
    guide[i] =
      (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    p[i] = mask[i] ? 1 : 0;
    gg[i] = guide[i] * guide[i];
    gp[i] = guide[i] * p[i];
  }
  const meanI = boxMean(guide, width, height, radius);
  const meanP = boxMean(p, width, height, radius);
  const meanGG = boxMean(gg, width, height, radius);
  const meanGP = boxMean(gp, width, height, radius);
  const a = new Float64Array(length);
  const b = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const varI = meanGG[i] - meanI[i] * meanI[i];
    const cov = meanGP[i] - meanI[i] * meanP[i];
    a[i] = cov / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = meanA[i] * guide[i] + meanB[i] >= 0.5 ? 1 : 0;
  }
  return out;
}

/**
 * B-4：主体边缘 despill —— 贴背景的主体像素若更接近背景色，用主体邻域中值色按强度混合，
 * 去掉抠图后残留的一圈背景色（白边）。
 */
export function despillEdge(
  cells: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  strength = 0.6
): void {
  const sub = new Uint8ClampedArray(cells);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      let touchesBg = false;
      const samples: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (mask[n]) samples.push(n * 4);
          else touchesBg = true;
        }
      }
      if (!touchesBg || samples.length < 2) continue;
      const off = index * 4;
      for (let c = 0; c < 3; c += 1) {
        const vals = samples.map((o) => sub[o + c]).sort((lhs, rhs) => lhs - rhs);
        const median = vals[Math.floor(vals.length / 2)];
        cells[off + c] = Math.round(sub[off + c] * (1 - strength) + median * strength);
      }
    }
  }
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

interface SubjectMetrics {
  subjectCount: number;
  largestComponent: number;
}

/** A.2：主体像素数与最大主体连通域（4 连通）。 */
function subjectMetrics(mask: Uint8Array, width: number, height: number): SubjectMetrics {
  const length = width * height;
  const seen = new Uint8Array(length);
  const stack: number[] = [];
  let subjectCount = 0;
  let largestComponent = 0;
  for (let i = 0; i < length; i += 1) if (mask[i] === 1) subjectCount += 1;
  for (let start = 0; start < length; start += 1) {
    if (mask[start] !== 1 || seen[start]) continue;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop()!;
      size += 1;
      const x = at % width;
      const y = Math.floor(at / width);
      if (x > 0 && mask[at - 1] === 1 && !seen[at - 1]) { seen[at - 1] = 1; stack.push(at - 1); }
      if (x < width - 1 && mask[at + 1] === 1 && !seen[at + 1]) { seen[at + 1] = 1; stack.push(at + 1); }
      if (y > 0 && mask[at - width] === 1 && !seen[at - width]) { seen[at - width] = 1; stack.push(at - width); }
      if (y < height - 1 && mask[at + width] === 1 && !seen[at + width]) { seen[at + width] = 1; stack.push(at + width); }
    }
    if (size > largestComponent) largestComponent = size;
  }
  return { subjectCount, largestComponent };
}

/**
 * A.2 统一回退出口：判为「抠图不可信」时返回全主体（等价未去背景），
 * 保证默认开启也绝不吞主体、不产空图纸。
 */
function fallbackAllSubject(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  subjectRatio: number,
  largestComponentRatio: number
): SubjectResult {
  return {
    cells: new Uint8ClampedArray(data),
    mask: new Uint8Array(width * height).fill(1),
    bbox: { x0: 0, y0: 0, x1: width - 1, y1: height - 1 },
    reliable: false,
    subjectRatio,
    largestComponentRatio
  };
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
      return fallbackAllSubject(data, width, height, 1, 1);
    }
    background = result.bg;
  }

  const mask = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    if (!background[i] && data[i * 4 + 3] > 0) mask[i] = 1;
  }

  // B-2：粗糙掩码先做引导滤波精修（只并集补回主体侧，不收缩——见 refineMaskGuided 注释），再丢小孤岛。
  const roughMask = fillSmallHoles(mask, width, height, holeMax);
  const guidedMask = refineMaskGuided(data, roughMask, width, height);
  const refinedMask = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    refinedMask[i] = roughMask[i] || guidedMask[i] ? 1 : 0;
  }
  const cleanedMask = dropTinyIslands(refinedMask, width, height, minArea);
  const metrics = subjectMetrics(cleanedMask, width, height);
  const subjectRatio = metrics.subjectCount / length;
  const largestComponentRatio = metrics.subjectCount
    ? metrics.largestComponent / metrics.subjectCount
    : 0;

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
  if (!Number.isFinite(x0)) {
    return fallbackAllSubject(data, width, height, subjectRatio, largestComponentRatio);
  }
  // B-4：去掉主体边缘残留的背景色（白边）。
  despillEdge(cells, cleanedMask, width, height);

  // A.2 可信度门：主体被打碎 / 占比过低 / 几乎无背景可去 → 判不可信，回退全主体。
  const bboxRatio = ((x1 - x0 + 1) * (y1 - y0 + 1)) / length;
  const reliable =
    subjectRatio >= SUBJECT_RATIO_MIN &&
    largestComponentRatio >= SUBJECT_COMPONENT_MIN &&
    bboxRatio <= SUBJECT_BBOX_MAX;
  if (!reliable) {
    return fallbackAllSubject(data, width, height, subjectRatio, largestComponentRatio);
  }

  return {
    cells,
    mask: cleanedMask,
    bbox: { x0, y0, x1, y1 },
    reliable: true,
    subjectRatio,
    largestComponentRatio
  };
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
