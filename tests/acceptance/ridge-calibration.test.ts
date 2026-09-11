/**
 * 去背景「脊可分离性」实测台（B-1 自适应阈值 spike 的工具）。
 *
 * 回答一个问题：**对这张图，是否存在一个脊阈值，能把主体轮廓和背景分开？**
 * 做法（不需要真值）：
 *   1. 用「边界中位色 bgLab + tol」算出**洪水可通行集合**（floodable）；
 *   2. 取其**内边界带**（floodable 中与不可通行区相邻的像素）= 主体轮廓所在位置；
 *   3. 取**深背景**（floodable 中距内边界 > 2·s_max=16px 的像素）= 纯背景结构；
 *   4. 比较两者的脊分布：轮廓带要能被一个阈值挑出来，必须显著高于深背景。
 * 若两者重叠（轮廓带 p90 ≤ 深背景 p90），则任何全局绝对阈值都不可能成立。
 *
 * 运行：
 *   $env:CALIBRATE='1'; npx vitest run tests/acceptance/ridge-calibration.test.ts
 * 真实样例（拿到 rabbit-source.png 之后）：
 *   $env:SUBJECT_SAMPLE='tests/fixtures/rabbit-source.png'; $env:EVIDENCE_DIR='.tools/acceptance/out'
 *   npx vitest run tests/acceptance/ridge-calibration.test.ts
 * 只支持 PNG（本仓库无 JPEG 解码器）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ciede76 } from '../../src/core/color/ciede2000';
import { srgbRgbToLab } from '../../src/core/color/lab';
import { buildRidge, extractSubject, SUBJECT_TOL } from '../../src/core/pipeline/subject';
import { hardSquare, rabbitLike, recovery, softWhiteSubject, type Fixture } from '../support/fixtures';
import { maskToImage, readPng, writePng } from '../support/png';
import type { CellImage } from '../../src/types';

const SWEEP = [0.05, 0.1, 0.2, 0.3, 0.38, 0.45, 0.6, 1, 2, 4, 8, 12];
const VERBOSE = process.env.CALIBRATE === '1' || Boolean(process.env.SUBJECT_SAMPLE);
const MAX_SCALE = 16;

function countOnes(mask: Uint8Array): number {
  let n = 0;
  for (const value of mask) if (value) n += 1;
  return n;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** 与 subject.ts 内部 borderMedianLab 同一算法（校准台自带一份，避免为它开口子导出）。 */
function borderMedianLab(image: CellImage): [number, number, number] {
  const { width, height, data } = image;
  const indices: number[] = [];
  for (let x = 0; x < width; x += 1) {
    indices.push(x);
    if (height > 1) indices.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    indices.push(y * width);
    if (width > 1) indices.push(y * width + width - 1);
  }
  const entries = indices.map((index) => labAt(image, index));
  entries.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return entries[Math.floor(entries.length / 2)];
}

function labAt(image: CellImage, index: number): [number, number, number] {
  const offset = index * 4;
  return srgbRgbToLab([image.data[offset], image.data[offset + 1], image.data[offset + 2]]);
}

function separability(label: string, image: CellImage): void {
  const { width, height, data } = image;
  const length = width * height;
  const ridge = buildRidge(data, width, height);
  const bgLab = borderMedianLab(image);
  const floodable = new Uint8Array(length);
  let floodableCount = 0;
  for (let i = 0; i < length; i += 1) {
    if (data[i * 4 + 3] < 128) continue;
    if (ciede76(bgLab, labAt(image, i)) <= SUBJECT_TOL) {
      floodable[i] = 1;
      floodableCount += 1;
    }
  }
  // 内边界带
  const boundary = new Uint8Array(length);
  let boundaryCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (!floodable[at]) continue;
      const touchesOutside =
        (x > 0 && !floodable[at - 1]) ||
        (x < width - 1 && !floodable[at + 1]) ||
        (y > 0 && !floodable[at - width]) ||
        (y < height - 1 && !floodable[at + width]);
      if (touchesOutside) {
        boundary[at] = 1;
        boundaryCount += 1;
      }
    }
  }
  // 多源 BFS：距内边界的距离（截断在 MAX_SCALE+1）
  const dist = new Int32Array(length).fill(MAX_SCALE + 1);
  const queue: number[] = [];
  for (let i = 0; i < length; i += 1) {
    if (boundary[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    if (dist[at] >= MAX_SCALE + 1) continue;
    const x = at % width;
    const y = Math.floor(at / width);
    const neighbours = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1
    ];
    for (const next of neighbours) {
      if (next < 0 || !floodable[next]) continue;
      if (dist[next] > dist[at] + 1) {
        dist[next] = dist[at] + 1;
        queue.push(next);
      }
    }
  }
  const boundaryRidge: number[] = [];
  const deepRidge: number[] = [];
  const nearRidge: number[] = [];
  for (let i = 0; i < length; i += 1) {
    if (!floodable[i]) continue;
    if (boundary[i]) boundaryRidge.push(ridge[i]);
    else if (dist[i] > MAX_SCALE) deepRidge.push(ridge[i]);
    else nearRidge.push(ridge[i]);
  }
  const b90 = percentile(boundaryRidge, 0.9);
  const d90 = percentile(deepRidge, 0.9);
  console.log(
    `SEP ${label} ${width}x${height} floodable=${floodableCount}px (${((floodableCount / length) * 100).toFixed(1)}%) 内边界=${boundaryCount}px`
  );
  console.log(
    `SEP   轮廓带脊 p50=${percentile(boundaryRidge, 0.5).toFixed(3)} p90=${b90.toFixed(3)} p99=${percentile(boundaryRidge, 0.99).toFixed(3)}`
  );
  console.log(
    `SEP   近界脊   p50=${percentile(nearRidge, 0.5).toFixed(3)} p90=${percentile(nearRidge, 0.9).toFixed(3)} p99=${percentile(nearRidge, 0.99).toFixed(3)}`
  );
  console.log(
    `SEP   深背景脊 p50=${percentile(deepRidge, 0.5).toFixed(3)} p90=${d90.toFixed(3)} p99=${percentile(deepRidge, 0.99).toFixed(3)} n=${deepRidge.length}`
  );
  console.log(
    `SEP   可分离度 = 轮廓带p90 / 深背景p90 = ${d90 > 0 ? (b90 / d90).toFixed(2) : 'inf'}  (>1 才存在可用窗口；越大越稳)`
  );
}

function sweep(label: string, image: CellImage, fixture: Fixture | null): void {
  const truthCells = fixture ? countOnes(fixture.truth) : 0;
  for (const edge of SWEEP) {
    const result = extractSubject(image, { edge });
    const subject = countOnes(result.mask);
    const quality = fixture ? recovery(result.mask, fixture.truth) : null;
    const area = truthCells ? `${((subject / truthCells) * 100).toFixed(1)}%` : '-';
    console.log(
      `SWEEP ${label} edge=${String(edge).padEnd(5)} reliable=${String(result.reliable).padEnd(5)} ratio=${result.subjectRatio.toFixed(3)} comp=${result.largestComponentRatio.toFixed(3)} 主体=${String(subject).padStart(7)} 面积/真值=${area.padStart(6)} 保回=${quality ? `${(quality.recovery * 100).toFixed(1)}%` : '-'} bbox=${result.bbox ? `${result.bbox.x0},${result.bbox.y0},${result.bbox.x1},${result.bbox.y1}` : 'null'}`
    );
    const dir = process.env.EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writePng(resolve(dir, `cal-${label}-edge${edge}.png`), maskToImage(result.mask, image.width, image.height));
    }
  }
}

function analyse(label: string, image: CellImage, fixture: Fixture | null): void {
  if (!VERBOSE) return;
  separability(label, image);
  sweep(label, image, fixture);
}

describe('去背景脊可分离性实测台', () => {
  it('夹具（CALIBRATE=1 时打印）', () => {
    analyse('soft', softWhiteSubject().image, softWhiteSubject());
    analyse('rabbit', rabbitLike().image, rabbitLike());
    analyse('hard', hardSquare().image, hardSquare());
    expect(true).toBe(true);
  });

  it('仓库内真实样例', () => {
    analyse('cartoon', readPng(resolve(process.cwd(), 'public/samples/sample-cartoon.png')), null);
    analyse('photo', readPng(resolve(process.cwd(), 'tests/fixtures/sample-photo.png')), null);
    expect(true).toBe(true);
  });

  it('外部真实样例（SUBJECT_SAMPLE=path）', () => {
    const sample = process.env.SUBJECT_SAMPLE;
    if (!sample) {
      console.log('SKIP 未设置 SUBJECT_SAMPLE（拿到 rabbit-source.png 后见文件头命令）');
      return;
    }
    const path = resolve(process.cwd(), sample);
    if (!existsSync(path)) {
      console.log(`SKIP 样例不存在: ${path}`);
      return;
    }
    const image = readPng(path);
    analyse(`sample:${sample}`, image, null);
    expect(image.width).toBeGreaterThan(0);
  });

  /**
   * 尺度扫描（CALIBRATE=1）：软边宽度占主体半径的比例，是决定屏障「误差能否被忽略」的隐藏变量。
   * 每个比例取「扫描内最优的一档」作为该比例的代表（最优 = 保回最高、面积最接近真值）。
   */
  it('软边尺度扫描（CALIBRATE=1 时打印）', () => {
    if (!VERBOSE) {
      expect(true).toBe(true);
      return;
    }
    for (const ratio of [0.16, 0.08, 0.04, 0.02, 0.01]) {
      const fixture = softWhiteSubject(240, ratio);
      let best = '';
      let bestScore = Number.POSITIVE_INFINITY;
      const edgePx = (ratio * 240 * 0.34).toFixed(1);
      for (const edge of SWEEP) {
        const result = extractSubject(fixture.image, { edge });
        const subject = countOnes(result.mask);
        const truth = countOnes(fixture.truth);
        const recoveryRate = recovery(result.mask, fixture.truth).recovery;
        const area = subject / truth;
        // 只在「可信」的档位里比较；分数 = 面积偏离 1 的程度 + 未保回的部分
        if (!result.reliable) continue;
        const score = Math.abs(area - 1) + (1 - recoveryRate) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = `edge=${String(edge).padEnd(5)} 保回=${(recoveryRate * 100).toFixed(1)}% 面积/真值=${(area * 100).toFixed(1)}% ratio=${result.subjectRatio.toFixed(3)}`;
        }
      }
      console.log(
        `RATIO soft 软边=${edgePx}px (占比 ${(ratio * 100).toFixed(1)}%) 最优档: ${best || '无可信档位（全部回退或被判不可信）'}`
      );
    }
    expect(true).toBe(true);
  });

  /**
   * 信号/背景噪声比预测器：S = floodable 集合内的脊峰值（近白类图里主体软轮廓就在这个集合内；
   * 深色特征如眼睛因 ΔE>tol 被排除），B = 深背景脊 p90（洪水真正要穿越的背景结构）。
   * 用它预测「是否存在可用阈值窗口」，并用夹具的已知成败验证这个预测器。
   */
  it('信号/背景噪声比（CALIBRATE=1 时打印）', () => {
    if (!VERBOSE) {
      expect(true).toBe(true);
      return;
    }
    for (const ratio of [0.16, 0.08, 0.04, 0.02, 0.01]) {
      const stats = signalToBackground(softWhiteSubject(240, ratio).image);
      console.log(
        `SNR soft 软边占比=${(ratio * 100).toFixed(1)}% S=${stats.signal.toFixed(3)} B=${stats.background.toFixed(3)} S/B=${(stats.signal / Math.max(stats.background, 1e-6)).toFixed(2)}`
      );
    }
    for (const [name, image] of [
      ['rabbit', rabbitLike().image],
      ['hard', hardSquare().image],
      ['cartoon', readPng(resolve(process.cwd(), 'public/samples/sample-cartoon.png'))],
      ['photo', readPng(resolve(process.cwd(), 'tests/fixtures/sample-photo.png'))]
    ] as const) {
      const stats = signalToBackground(image);
      console.log(
        `SNR ${name} S=${stats.signal.toFixed(3)} B=${stats.background.toFixed(3)} S/B=${(stats.signal / Math.max(stats.background, 1e-6)).toFixed(2)} floodable=${((stats.floodable / (image.width * image.height)) * 100).toFixed(1)}%`
      );
    }
    expect(true).toBe(true);
  });

  /**
   * 能力围栏：在**真实尺度**的软边（软边宽度 ≈ 主体半径的 2%，而 docs/43 §4.1 原样夹具是 16%）下，
   * 存在一档 EDGE 能给出「可信 + 主体基本保全 + 面积误差 ≤ 15%」的掩码。
   * 注意：这证明的是**能力存在**，不等于默认可以开启——默认值由真实样例（rabbit-source.png）上的
   * G1–G4 门禁决定，见 docs/44 §6.5 与 §8。
   */
  it('能力围栏：真实尺度软边（2% 半径）下存在可用阈值档位', () => {
    const fixture = softWhiteSubject(240, 0.02);
    const truth = countOnes(fixture.truth);
    let usable = '';
    for (const edge of SWEEP) {
      const result = extractSubject(fixture.image, { edge });
      if (!result.reliable) continue;
      const area = countOnes(result.mask) / truth;
      const kept = recovery(result.mask, fixture.truth).recovery;
      if (kept >= 0.9 && area >= 0.9 && area <= 1.15) {
        usable = `edge=${edge} 保回=${(kept * 100).toFixed(1)}% 面积/真值=${(area * 100).toFixed(1)}%`;
        break;
      }
    }
    console.log(`CAPABILITY 真实尺度(2%)软边可用档位: ${usable || '无'}`);
    expect(usable).not.toBe('');
  });
});

/** S = floodable 集合脊峰值（剔除距 floodable 边界 ≤3px 的像素以避开特征边）；B = 深背景脊 p90。 */
function signalToBackground(image: CellImage): {
  signal: number;
  background: number;
  floodable: number;
} {
  const { width, height, data } = image;
  const length = width * height;
  const ridge = buildRidge(data, width, height);
  const bgLab = borderMedianLab(image);
  const floodable = new Uint8Array(length);
  let floodableCount = 0;
  for (let i = 0; i < length; i += 1) {
    if (data[i * 4 + 3] < 128) continue;
    if (ciede76(bgLab, labAt(image, i)) <= SUBJECT_TOL) {
      floodable[i] = 1;
      floodableCount += 1;
    }
  }
  const boundary = new Uint8Array(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (!floodable[at]) continue;
      const touchesOutside =
        (x > 0 && !floodable[at - 1]) ||
        (x < width - 1 && !floodable[at + 1]) ||
        (y > 0 && !floodable[at - width]) ||
        (y < height - 1 && !floodable[at + width]);
      if (touchesOutside) boundary[at] = 1;
    }
  }
  const dist = new Int32Array(length).fill(MAX_SCALE + 1);
  const queue: number[] = [];
  for (let i = 0; i < length; i += 1) {
    if (boundary[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    if (dist[at] >= MAX_SCALE + 1) continue;
    const x = at % width;
    const y = Math.floor(at / width);
    const neighbours = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1
    ];
    for (const next of neighbours) {
      if (next < 0 || !floodable[next]) continue;
      if (dist[next] > dist[at] + 1) {
        dist[next] = dist[at] + 1;
        queue.push(next);
      }
    }
  }
  let signal = 0;
  const deep: number[] = [];
  for (let i = 0; i < length; i += 1) {
    if (!floodable[i]) continue;
    if (dist[i] > 3 && ridge[i] > signal) signal = ridge[i];
    if (dist[i] > MAX_SCALE) deep.push(ridge[i]);
  }
  return { signal, background: percentile(deep, 0.9), floodable: floodableCount };
}
